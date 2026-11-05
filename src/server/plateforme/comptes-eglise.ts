import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { env } from "@/lib/env";
import { FORMAT_JETON_COMPTE, empreinteJeton } from "@/lib/jetons";
import { ROLES_COMPTE } from "@/lib/roles";
import { normaliserTelephone } from "@/lib/telephone";
import type { ContexteEglise } from "@/lib/tenant";
import {
  CompteRefuse,
  DOMAINE_SANS_EMAIL,
  creerCompte,
  definirMotDePasse,
  emettreJetonCompte,
} from "./comptes";
import { prismaPlateforme, withEglise, type TransactionPrisma } from "./db";
import { consommer } from "./limitation";

/**
 * Accounts of a church (cahier §7.10, ADR 0014), managed by its ADMIN: creation with a
 * one-time activation link, direct attachment of an existing account, activation and
 * password reset links. The church always comes from the session context. Only links of
 * accounts that belong to this church alone can be issued here: otherwise an administrator
 * could take over an account of another church (the super-administrator does it). The audit
 * holds identifiers and roles only, never names, addresses or tokens.
 */

type Auteur = Pick<ContexteEglise, "egliseId" | "userId" | "appareil">;

export const RESERVE_SUPER_ADMIN =
  "Cette opération sur ce compte est réservée au super-administrateur : demandez-la-lui.";
export const LIEN_INVALIDE =
  "Ce lien a expiré ou a déjà servi. Demandez un nouveau lien à l'administrateur de votre église.";

async function journaliser(
  tx: TransactionPrisma,
  auteur: Auteur,
  entree: { action: string; entite: string; entiteId: string; avant?: object; apres?: object },
) {
  await tx.auditLog.create({
    data: {
      egliseId: auteur.egliseId,
      userId: auteur.userId,
      appareil: auteur.appareil,
      action: entree.action,
      entite: entree.entite,
      entiteId: entree.entiteId,
      avant: entree.avant as Prisma.InputJsonValue | undefined,
      apres: entree.apres as Prisma.InputJsonValue | undefined,
    },
  });
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export type EtatCompte = "actif" | "en_attente" | "reinitialisation" | "lien_expire" | "desactive";

export type CompteAffiche = {
  membreId: string;
  nom: string;
  /** E-mail, or phone number for a phone-only account. */
  email: string | null;
  telephone: string | null;
  roles: Role[];
  etat: EtatCompte;
  soi: boolean;
};

/**
 * Members of the church with the state of their account. The open link is read with
 * PostgreSQL's clock (`expireLe > now()`), the one that set it.
 */
export async function listerComptes(
  base: PrismaClient,
  contexte: Pick<ContexteEglise, "egliseId" | "userId">,
): Promise<CompteAffiche[]> {
  const lignes = await base.$queryRaw<
    {
      membreId: string;
      userId: string;
      nom: string;
      email: string;
      telephone: string | null;
      roles: Role[];
      actif: boolean;
      motDePasse: boolean;
      lien: "ACTIVATION" | "REINITIALISATION" | null;
    }[]
  >`
    SELECT m.id AS "membreId", u.id AS "userId", u.name AS nom, u.email, u.telephone,
           m.roles::text[] AS roles, (m.actif AND u.actif) AS actif,
           EXISTS (SELECT 1 FROM "AuthAccount" a
                   WHERE a."userId" = u.id AND a."providerId" = 'credential'
                     AND a.password IS NOT NULL) AS "motDePasse",
           (SELECT j.type::text FROM "JetonCompte" j
             WHERE j."userId" = u.id AND j."consommeLe" IS NULL AND j."revoqueLe" IS NULL
               AND j."expireLe" > now()
             ORDER BY j."createdAt" DESC LIMIT 1) AS lien
    FROM "Membre" m JOIN "User" u ON u.id = m."userId"
    WHERE m."egliseId" = ${contexte.egliseId}
    ORDER BY u.name, m.id`;
  return lignes.map((l) => ({
    membreId: l.membreId,
    nom: l.nom,
    email: l.email.endsWith(DOMAINE_SANS_EMAIL) ? null : l.email,
    telephone: l.telephone,
    roles: l.roles,
    etat: !l.actif
      ? "desactive"
      : l.lien === "REINITIALISATION"
        ? "reinitialisation"
        : l.motDePasse
          ? "actif"
          : l.lien === "ACTIVATION"
            ? "en_attente"
            : "lien_expire",
    soi: l.userId === contexte.userId,
  }));
}

// ---------------------------------------------------------------------------
// Creation or attachment
// ---------------------------------------------------------------------------

export const schemaNouveauCompte = z.object({
  nom: z.string().trim().min(2, "Saisissez le nom de la personne.").max(80),
  identifiant: z
    .string()
    .trim()
    .min(1, "Saisissez l'e-mail ou le téléphone de la personne.")
    .max(120),
  roles: z.array(z.enum(ROLES_COMPTE)).min(1, "Choisissez au moins un rôle."),
});

function lireIdentifiant(
  saisie: string,
  indicatif: string,
): { email: string } | { telephone: string } {
  if (saisie.includes("@")) {
    const email = saisie.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new CompteRefuse("Cette adresse e-mail n'est pas valide. Vérifiez-la.");
    }
    return { email };
  }
  const resultat = normaliserTelephone(saisie, indicatif);
  if (resultat.statut === "valide") return { telephone: resultat.e164 };
  if (resultat.statut === "a_confirmer") {
    throw new CompteRefuse(`${resultat.message} Saisissez le numéro complet.`);
  }
  throw new CompteRefuse(resultat.message);
}

export type ResultatAjout =
  { statut: "cree"; membreId: string; jeton: string } | { statut: "rattache"; membreId: string };

/**
 * Adds an account to the church. A new account is created without a password, with an
 * activation link. An existing account (same e-mail or phone) is attached directly with the
 * chosen roles; the answer stays neutral and says nothing of its other churches.
 */
export async function ajouterCompte(
  base: PrismaClient,
  auteur: Auteur,
  saisieBrute: unknown,
  indicatif: string,
): Promise<ResultatAjout> {
  const saisie = schemaNouveauCompte.parse(saisieBrute);
  const identifiant = lireIdentifiant(saisie.identifiant, indicatif);
  return withEglise(base, auteur.egliseId, async (tx) => {
    const existant = await tx.user.findFirst({ where: identifiant, select: { id: true } });
    if (existant) {
      const membre = await tx.membre.findUnique({
        where: { egliseId_userId: { egliseId: auteur.egliseId, userId: existant.id } },
        select: { actif: true },
      });
      if (membre) {
        throw new CompteRefuse(
          membre.actif
            ? "Ce compte fait déjà partie de votre église."
            : "Ce compte fait déjà partie de votre église, désactivé : réactivez-le dans la liste.",
        );
      }
      const { id } = await tx.membre.create({
        data: { egliseId: auteur.egliseId, userId: existant.id, roles: saisie.roles },
        select: { id: true },
      });
      await journaliser(tx, auteur, {
        action: "membre.rattache",
        entite: "Membre",
        entiteId: id,
        apres: { roles: saisie.roles },
      });
      return { statut: "rattache", membreId: id };
    }

    const userId = await creerCompte(tx, {
      nom: saisie.nom,
      email: "email" in identifiant ? identifiant.email : null,
      telephone: "telephone" in identifiant ? identifiant.telephone : null,
    });
    const { id } = await tx.membre.create({
      data: { egliseId: auteur.egliseId, userId, roles: saisie.roles },
      select: { id: true },
    });
    const jeton = await emettreJetonCompte(tx, {
      userId,
      egliseId: auteur.egliseId,
      type: "ACTIVATION",
      creePar: auteur.userId,
    });
    await journaliser(tx, auteur, {
      action: "compte.cree",
      entite: "Membre",
      entiteId: id,
      apres: { roles: saisie.roles },
    });
    return { statut: "cree", membreId: id, jeton };
  });
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/**
 * Locks a member of the church and reads what decides whether a link may be issued.
 * Null for a member of another church (same as a missing one).
 */
async function compteDuMembre(tx: TransactionPrisma, egliseId: string, membreId: string) {
  const lignes = await tx.$queryRaw<
    {
      userId: string;
      actif: boolean;
      superAdmin: boolean;
      autresEglises: boolean;
      motDePasse: boolean;
    }[]
  >`
    SELECT m."userId", (m.actif AND u.actif) AS actif, u."superAdmin",
           EXISTS (SELECT 1 FROM "Membre" o
                   WHERE o."userId" = m."userId" AND o."egliseId" <> m."egliseId") AS "autresEglises",
           EXISTS (SELECT 1 FROM "AuthAccount" a
                   WHERE a."userId" = m."userId" AND a."providerId" = 'credential'
                     AND a.password IS NOT NULL) AS "motDePasse"
    FROM "Membre" m JOIN "User" u ON u.id = m."userId"
    WHERE m.id = ${membreId} AND m."egliseId" = ${egliseId}
    FOR UPDATE OF m`;
  const compte = lignes[0];
  if (!compte) return null;
  if (compte.superAdmin || compte.autresEglises) throw new CompteRefuse(RESERVE_SUPER_ADMIN);
  if (!compte.actif) throw new CompteRefuse("Ce compte est désactivé : réactivez-le d'abord.");
  return compte;
}

/** New activation link for an account never activated (the previous link is revoked). */
export async function genererLienActivation(
  base: PrismaClient,
  auteur: Auteur,
  membreId: string,
): Promise<{ jeton: string } | null> {
  return withEglise(base, auteur.egliseId, async (tx) => {
    const compte = await compteDuMembre(tx, auteur.egliseId, membreId);
    if (!compte) return null;
    if (compte.motDePasse) {
      throw new CompteRefuse(
        "Ce compte est déjà activé. Pour un mot de passe oublié, utilisez « Réinitialiser le mot de passe ».",
      );
    }
    const jeton = await emettreJetonCompte(tx, {
      userId: compte.userId,
      egliseId: auteur.egliseId,
      type: "ACTIVATION",
      creePar: auteur.userId,
    });
    await journaliser(tx, auteur, {
      action: "compte.lien_activation",
      entite: "Membre",
      entiteId: membreId,
    });
    return { jeton };
  });
}

/**
 * Password reset, effective at once: the password is erased and every session of the
 * account is closed, then a reset link (24 hours) is issued.
 */
export async function reinitialiserMotDePasse(
  base: PrismaClient,
  auteur: Auteur,
  membreId: string,
): Promise<{ jeton: string } | null> {
  return withEglise(base, auteur.egliseId, async (tx) => {
    const compte = await compteDuMembre(tx, auteur.egliseId, membreId);
    if (!compte) return null;
    if (!compte.motDePasse) {
      throw new CompteRefuse(
        "Ce compte n'est pas encore activé : générez un nouveau lien d'activation.",
      );
    }
    await tx.authAccount.updateMany({
      where: { userId: compte.userId, providerId: "credential" },
      data: { password: null },
    });
    const { count: sessionsFermees } = await tx.authSession.deleteMany({
      where: { userId: compte.userId },
    });
    const jeton = await emettreJetonCompte(tx, {
      userId: compte.userId,
      egliseId: auteur.egliseId,
      type: "REINITIALISATION",
      creePar: auteur.userId,
    });
    await journaliser(tx, auteur, {
      action: "compte.reinitialise",
      entite: "Membre",
      entiteId: membreId,
      apres: { sessionsFermees },
    });
    return { jeton };
  });
}

// ---------------------------------------------------------------------------
// Activation (public page)
// ---------------------------------------------------------------------------

export const schemaActivation = z
  .object({
    jeton: z.string().regex(FORMAT_JETON_COMPTE, LIEN_INVALIDE),
    motDePasse: z
      .string()
      .min(10, "Le mot de passe doit contenir au moins 10 caractères.")
      .max(128, "Le mot de passe ne doit pas dépasser 128 caractères."),
    confirmation: z.string(),
  })
  .refine((s) => s.motDePasse === s.confirmation, {
    message: "Les deux mots de passe ne sont pas identiques. Saisissez-les de nouveau.",
    path: ["confirmation"],
  });

/**
 * Sets the password chosen through a link and consumes the link, in one transaction. An
 * unknown, expired (PostgreSQL clock), used or revoked link, or a membership deactivated
 * since, gives the same refusal. Every session of the account is closed.
 */
export async function activerCompte(
  base: PrismaClient,
  saisieBrute: unknown,
): Promise<{ type: "ACTIVATION" | "REINITIALISATION" }> {
  const saisie = schemaActivation.parse(saisieBrute);
  return base.$transaction(async (tx) => {
    const lignes = await tx.$queryRaw<
      {
        id: string;
        userId: string;
        egliseId: string;
        type: "ACTIVATION" | "REINITIALISATION";
        valide: boolean;
      }[]
    >`
      SELECT j.id, j."userId", j."egliseId", j.type::text AS type,
             (j."consommeLe" IS NULL AND j."revoqueLe" IS NULL AND j."expireLe" > now()
              AND EXISTS (SELECT 1 FROM "Membre" m
                          WHERE m."userId" = j."userId" AND m."egliseId" = j."egliseId"
                            AND m.actif)) AS valide
      FROM "JetonCompte" j WHERE j."tokenHash" = ${empreinteJeton(saisie.jeton)}
      FOR UPDATE OF j`;
    const lien = lignes[0];
    if (!lien?.valide) throw new CompteRefuse(LIEN_INVALIDE);

    await definirMotDePasse(tx, lien.userId, saisie.motDePasse);
    await tx.$executeRaw`UPDATE "JetonCompte" SET "consommeLe" = now() WHERE id = ${lien.id}`;
    await tx.$executeRaw`
      UPDATE "JetonCompte" SET "revoqueLe" = now()
      WHERE "userId" = ${lien.userId} AND "consommeLe" IS NULL AND "revoqueLe" IS NULL`;
    await tx.authSession.deleteMany({ where: { userId: lien.userId } });

    // Audit of the church that issued the link, under its RLS context.
    await tx.$executeRaw`SELECT set_config('app.eglise_id', ${lien.egliseId}, TRUE)`;
    await journaliser(
      tx,
      { egliseId: lien.egliseId, userId: lien.userId, appareil: null },
      {
        action: lien.type === "ACTIVATION" ? "compte.active" : "compte.mot_de_passe_reinitialise",
        entite: "User",
        entiteId: lien.userId,
      },
    );
    return { type: lien.type };
  });
}

/**
 * Link to send: the token is in the fragment (after "#"), which the browser never sends to
 * the server, so it reaches no server or hosting log.
 */
export function lienCompte(jeton: string): string {
  return `${env().BETTER_AUTH_URL.replace(/\/$/, "")}/activation#${jeton}`;
}

// Entry points for pages and Server Actions (shared platform client).

export function comptesDeLEglise(contexte: ContexteEglise) {
  return listerComptes(prismaPlateforme(), contexte);
}

export function ajouterCompteEglise(contexte: ContexteEglise, saisie: unknown, indicatif: string) {
  return ajouterCompte(prismaPlateforme(), contexte, saisie, indicatif);
}

export function lienActivationEglise(contexte: ContexteEglise, membreId: string) {
  return genererLienActivation(prismaPlateforme(), contexte, membreId);
}

export function reinitialisationEglise(contexte: ContexteEglise, membreId: string) {
  return reinitialiserMotDePasse(prismaPlateforme(), contexte, membreId);
}

/** Attempts on the public activation page, per IP address (shared tablets share an IP). */
export const REGLE_ACTIVATION = { fenetreMs: 15 * 60 * 1000, max: 20 };

/** Public activation page: no session, no church; attempts are limited per IP address. */
export async function activerMonCompte(saisie: unknown, ip: string) {
  const base = prismaPlateforme();
  const essai = await consommer(base, `activation:ip:${ip}`, REGLE_ACTIVATION, new Date());
  if (!essai.autorise) {
    const minutes = Math.max(1, Math.ceil(essai.reessayerDansMs / 60_000));
    throw new CompteRefuse(`Trop de tentatives. Réessayez dans ${minutes} minutes.`);
  }
  return activerCompte(base, saisie);
}

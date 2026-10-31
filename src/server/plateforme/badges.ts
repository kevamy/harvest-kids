import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { Role } from "@/generated/prisma/enums";
import { empreinteJeton, genererJetonBadge } from "@/lib/jetons";
import type { ClientEglise, ContexteEglise } from "@/lib/tenant";
import type { VerificationMoniteur } from "@/server/cartes/resolution";
import { formatParId, type IdFormat } from "@/server/impression/formats";
import {
  genererPdfCartes,
  type EgliseImpression,
  type OptionsImpression,
} from "@/server/impression/pdf-carte";
import { corpsNomBadge } from "@/server/impression/mesure";
import { TEXTES_BADGE, TYPO } from "@/server/impression/textes";
import { lireParametres } from "@/server/parametres";
import { prismaPlateforme, withEglise, type TransactionPrisma } from "./db";

/**
 * Monitor badges (cahier §7.10, RG-02, RG-03, RG-14, ADR 0008). A badge belongs to a
 * member of the church (`Membre`, platform table) and is kept in `BadgeMoniteur` (church
 * table, under RLS), with its history: a new badge is active at once and revokes the
 * previous one; a member deactivated or who loses the MONITEUR role has their badge revoked
 * in the same transaction. The church always comes from the session context.
 */

type Auteur = Pick<ContexteEglise, "egliseId" | "userId" | "appareil">;

export class BadgeImpossible extends Error {
  constructor(readonly raison: "membre_inconnu" | "pas_moniteur") {
    super(`Badge impossible : ${raison}`);
    this.name = "BadgeImpossible";
  }
}

/** An active monitor: member and account active, MONITEUR role, in the active church. */
const moniteurActif = (egliseId: string) =>
  ({
    egliseId,
    actif: true,
    roles: { has: "MONITEUR" },
    user: { actif: true },
  }) satisfies Prisma.MembreWhereInput;

export function verificationMoniteur(
  base: PrismaClient,
  contexte: Pick<ContexteEglise, "egliseId">,
): VerificationMoniteur {
  return async (membreId) =>
    (await base.membre.count({ where: { id: membreId, ...moniteurActif(contexte.egliseId) } })) > 0;
}

/** Monitor check of the active church, with the shared platform client (pages, actions). */
export function prismaPourMoniteurs(contexte: ContexteEglise): VerificationMoniteur {
  return verificationMoniteur(prismaPlateforme(), contexte);
}

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

/** Locks the member row: badge and role changes of one member are serialised. */
async function verrouillerMembre(tx: TransactionPrisma, egliseId: string, membreId: string) {
  const lignes = await tx.$queryRaw<{ roles: Role[]; actif: boolean; compteActif: boolean }[]>`
    SELECT m.roles::text[] AS roles, m.actif, u.actif AS "compteActif"
    FROM "Membre" m JOIN "User" u ON u.id = m."userId"
    WHERE m.id = ${membreId} AND m."egliseId" = ${egliseId}
    FOR UPDATE OF m`;
  return lignes[0] ?? null;
}

async function revoquerBadgeActif(
  tx: TransactionPrisma,
  auteur: Auteur,
  membreId: string,
  raison: "remplace" | "membre_desactive" | "role_moniteur_retire",
): Promise<string[]> {
  const actifs = await tx.badgeMoniteur.findMany({
    where: { membreId, revoqueLe: null },
    select: { id: true },
  });
  if (actifs.length === 0) return [];
  const ids = actifs.map((b) => b.id);
  await tx.badgeMoniteur.updateMany({
    where: { id: { in: ids } },
    data: { revoqueLe: new Date() },
  });
  for (const id of ids) {
    await journaliser(tx, auteur, {
      action: "badge.revoque",
      entite: "BadgeMoniteur",
      entiteId: id,
      apres: { raison },
    });
  }
  return ids;
}

/** Bulk work: badges of every monitor in one transaction. */
const DUREE_TRANSACTION_MS = 45_000;

/**
 * Issues one badge per member with the tokens drawn beforehand (the PDF is rendered first):
 * the previous badge is revoked, the new one is active at once. Refused, without writing
 * anything, if one of them is not an active monitor of the church.
 */
export async function emettreBadges(
  base: PrismaClient,
  auteur: Auteur,
  emissions: { membreId: string; jeton: string }[],
): Promise<{ membreId: string; badgeId: string; revoques: string[] }[]> {
  return withEglise(
    base,
    auteur.egliseId,
    async (tx) => {
      const emis = [];
      for (const { membreId, jeton } of emissions) {
        const membre = await verrouillerMembre(tx, auteur.egliseId, membreId);
        if (!membre) throw new BadgeImpossible("membre_inconnu");
        if (!(membre.actif && membre.compteActif && membre.roles.includes("MONITEUR"))) {
          throw new BadgeImpossible("pas_moniteur");
        }
        const revoques = await revoquerBadgeActif(tx, auteur, membreId, "remplace");
        const badge = await tx.badgeMoniteur.create({
          data: { egliseId: auteur.egliseId, membreId, tokenHash: empreinteJeton(jeton) },
          select: { id: true },
        });
        await journaliser(tx, auteur, {
          action: "badge.emis",
          entite: "BadgeMoniteur",
          entiteId: badge.id,
          apres: { membreId, revoques },
        });
        emis.push({ membreId, badgeId: badge.id, revoques });
      }
      return emis;
    },
    { timeout: DUREE_TRANSACTION_MS },
  );
}

export const schemaModificationMembre = z
  .object({
    roles: z
      .array(z.enum(Object.values(Role) as [Role, ...Role[]]))
      .min(1, "Choisissez au moins un rôle.")
      .optional(),
    actif: z.boolean().optional(),
  })
  .refine((m) => m.roles !== undefined || m.actif !== undefined, "Aucune modification.");

/**
 * Changes a member's roles or deactivates them. When the member is no longer an active
 * monitor, their badge is revoked in the same transaction, with an audit entry: a scan of it
 * is then refused. Returns null for a member of another church (same as a missing one).
 */
export async function modifierMembre(
  base: PrismaClient,
  auteur: Auteur,
  membreId: string,
  saisie: unknown,
): Promise<{ badgesRevoques: string[] } | null> {
  const changement = schemaModificationMembre.parse(saisie);
  return withEglise(base, auteur.egliseId, async (tx) => {
    const avant = await verrouillerMembre(tx, auteur.egliseId, membreId);
    if (!avant) return null;
    const apres = await tx.membre.update({
      where: { id: membreId },
      data: changement,
      select: { roles: true, actif: true },
    });
    await journaliser(tx, auteur, {
      action: "membre.modifie",
      entite: "Membre",
      entiteId: membreId,
      avant: { roles: avant.roles, actif: avant.actif },
      apres,
    });
    const toujoursMoniteur = apres.actif && avant.compteActif && apres.roles.includes("MONITEUR");
    const badgesRevoques = toujoursMoniteur
      ? []
      : await revoquerBadgeActif(
          tx,
          auteur,
          membreId,
          apres.actif ? "role_moniteur_retire" : "membre_desactive",
        );
    return { badgesRevoques };
  });
}

export type MoniteurAffiche = { membreId: string; nom: string; badgeEmisLe: Date | null };

/** Active monitors of the church, by name, with the date of their current badge. */
export async function listerMoniteurs(
  base: PrismaClient,
  contexte: Pick<ContexteEglise, "egliseId">,
): Promise<MoniteurAffiche[]> {
  const membres = await base.membre.findMany({
    where: moniteurActif(contexte.egliseId),
    orderBy: [{ user: { name: "asc" } }, { id: "asc" }],
    select: { id: true, user: { select: { name: true } } },
  });
  const badges = await withEglise(base, contexte.egliseId, (tx) =>
    tx.badgeMoniteur.findMany({
      where: { revoqueLe: null, membreId: { in: membres.map((m) => m.id) } },
      select: { membreId: true, emisLe: true },
    }),
  );
  const emis = new Map(badges.map((b) => [b.membreId, b.emisLe]));
  return membres.map((m) => ({
    membreId: m.id,
    nom: m.user.name,
    badgeEmisLe: emis.get(m.id) ?? null,
  }));
}

export class ImpressionBadgesRefusee extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImpressionBadgesRefusee";
  }
}

export type ChoixBadges = {
  /** Monitors to print; all the church's active monitors when absent. */
  membreIds?: string[];
  format?: IdFormat;
  rectoVerso?: boolean;
  sortie?: OptionsImpression["sortie"];
};

/**
 * Prints badges with the church's print settings (same formats as the cards): tokens
 * drawn, PDF rendered in memory, then one transaction issues the badges. A rendering
 * failure issues nothing; the clear tokens only exist in the returned PDF.
 */
export async function imprimerBadges(
  base: PrismaClient,
  db: Pick<ClientEglise, "parametre">,
  auteur: Auteur,
  eglise: EgliseImpression,
  choix: ChoixBadges = {},
): Promise<{ pdf: Buffer; badges: number }> {
  const parametres = await lireParametres(db);
  const moniteurs = await listerMoniteurs(base, auteur);
  const vises = choix.membreIds
    ? moniteurs.filter((m) => choix.membreIds!.includes(m.membreId))
    : moniteurs;
  // An id of another church, or of a member who is not an active monitor, is not listed.
  if (choix.membreIds && vises.length !== new Set(choix.membreIds).size) {
    throw new ImpressionBadgesRefusee("Moniteur introuvable. Rechargez la page.");
  }
  if (vises.length === 0) {
    throw new ImpressionBadgesRefusee("Aucun moniteur actif : il n'y a aucun badge à imprimer.");
  }

  const idFormat = choix.format ?? parametres.impression.format;
  const format = formatParId(idFormat);
  const rectoVerso = choix.rectoVerso ?? parametres.impression.rectoVerso;
  const contenus = [];
  for (const m of vises) {
    contenus.push({
      membreId: m.membreId,
      jeton: genererJetonBadge(),
      moniteur: m.nom,
      // The name at the largest size that fits (the cap guarantees the smallest one does).
      corpsNom: (await corpsNomBadge(m.nom, format, !rectoVerso)) ?? TYPO.badge.nomMin,
    });
  }
  const pdf = await genererPdfCartes(
    contenus.map(({ jeton, moniteur, corpsNom }) => ({ jeton, moniteur, corpsNom })),
    { ...eglise, textes: TEXTES_BADGE },
    {
      format,
      rectoVerso,
      // Same rule as the cards: CR80 one badge per page, the other formats on A4 sheets.
      sortie: choix.sortie ?? (idFormat === "CR80" ? "unitaire" : "planche"),
    },
  );
  await emettreBadges(
    base,
    auteur,
    contenus.map(({ membreId, jeton }) => ({ membreId, jeton })),
  );
  return { pdf, badges: contenus.length };
}

// Entry points for pages, Server Actions and routes (shared platform client).

export function moniteursDeLEglise(contexte: ContexteEglise) {
  return listerMoniteurs(prismaPlateforme(), contexte);
}

export function imprimerBadgesEglise(
  db: Pick<ClientEglise, "parametre">,
  contexte: ContexteEglise,
  eglise: EgliseImpression,
  choix?: ChoixBadges,
) {
  return imprimerBadges(prismaPlateforme(), db, contexte, eglise, choix);
}

export function modifierMembreEglise(contexte: ContexteEglise, membreId: string, saisie: unknown) {
  return modifierMembre(prismaPlateforme(), contexte, membreId, saisie);
}

import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  FORMAT_JETON_ECRAN,
  FORMAT_SECRET_APPAREIL,
  empreinteJeton,
  genererJetonEcran,
  genererSecretAppareil,
} from "@/lib/jetons";
import { env } from "@/lib/env";
import type { ContexteEglise } from "@/lib/tenant";
import { prismaPlateforme, withEglise } from "./db";
import { consommerDans, essaisEcran } from "./limitation";

/**
 * Call screen (cahier §7.8, ADR 0018; decision of 2026-11-24). No ECRAN account: the ADMIN
 * adds a named screen and gets a pairing link (`/ecran/{slug}#HKE1.…`), shown once, valid
 * 24 hours, used once; opened on the screen's device, it is exchanged for a long-lived
 * device secret kept in an HttpOnly cookie. Each screen is revoked on its own; to replace a
 * device, revoke it and add a new screen. Only SHA-256 fingerprints are stored.
 *
 * EcranAppareil is a platform table (the screen has no session): this module is the only
 * place that reads it, always naming the church: the ADMIN's active church, or the church
 * of the paired device (never a church read from the address). The tiles are read inside
 * that church, under RLS (withEglise).
 */

/** Cookie of a paired screen (HttpOnly, only sent to the call screen's API). */
export const COOKIE_ECRAN = "hk_ecran";
export const CHEMIN_COOKIE_ECRAN = "/api/ecran";
/** 400 days, the longest a browser keeps a cookie; renewed while the screen is in use. */
export const DUREE_COOKIE_ECRAN_S = 400 * 24 * 60 * 60;

type Admin = { egliseId: string; userId: string; appareil: string | null };

export const schemaNomEcran = z
  .string({ message: "Donnez un nom à l'écran." })
  .trim()
  .min(2, "Donnez un nom à l'écran (2 caractères au moins).")
  .max(60, "Le nom tient en 60 caractères au plus.");

/**
 * The pairing link: the token in the fragment, never sent to a server nor written in a log
 * (same form as the activation links, ADR 0014).
 */
export const lienEcran = (origine: string, slug: string, jeton: string) =>
  `${origine.replace(/\/$/, "")}/ecran/${slug}#${jeton}`;

/**
 * A new screen of the admin's church and its pairing link, shown once. `origine` is the
 * application's address (BETTER_AUTH_URL, read by the caller).
 */
export async function creerEcran(
  base: PrismaClient,
  admin: Admin,
  nom: unknown,
  origine: string,
): Promise<{ id: string; jeton: string; lien: string }> {
  const nomValide = schemaNomEcran.parse(nom);
  const jeton = genererJetonEcran();
  return base.$transaction(async (tx) => {
    const [cree] = await tx.$queryRaw<{ id: string; slug: string }[]>`
      INSERT INTO "EcranAppareil" (id, "egliseId", nom, "jetonHash", "jetonExpireLe", "creePar")
      VALUES (${randomUUID()}, ${admin.egliseId}, ${nomValide}, ${empreinteJeton(jeton)},
              now() + interval '24 hours', ${admin.userId})
      RETURNING id, (SELECT slug FROM "Eglise" WHERE id = ${admin.egliseId}) AS slug`;
    await tx.auditPlateforme.create({
      data: {
        userId: admin.userId,
        egliseId: admin.egliseId,
        action: "ecran.creer",
        detail: { ecranId: cree!.id },
        appareil: admin.appareil,
      },
    });
    return { id: cree!.id, jeton, lien: lienEcran(origine, cree!.slug, jeton) };
  });
}

export type EtatEcran = "en_attente" | "lien_expire" | "appaire" | "revoque";

export type EcranListe = {
  id: string;
  nom: string;
  etat: EtatEcran;
  /** "24/11/2026 10:42", in the church's time zone; null when not yet. */
  creeLe: string;
  appaireLe: string | null;
  derniereVue: string | null;
};

/** Screens of the admin's church, newest first; never another church's. */
export async function listerEcrans(
  base: PrismaClient,
  admin: Pick<Admin, "egliseId">,
): Promise<EcranListe[]> {
  return base.$queryRaw<EcranListe[]>`
    SELECT e.id, e.nom,
           CASE WHEN e."revoqueLe" IS NOT NULL THEN 'revoque'
                WHEN e."appaireLe" IS NOT NULL THEN 'appaire'
                WHEN e."jetonExpireLe" <= now() THEN 'lien_expire'
                ELSE 'en_attente' END AS etat,
           to_char(e."creeLe" AT TIME ZONE 'UTC' AT TIME ZONE g.fuseau, 'DD/MM/YYYY HH24:MI') AS "creeLe",
           to_char(e."appaireLe" AT TIME ZONE 'UTC' AT TIME ZONE g.fuseau, 'DD/MM/YYYY HH24:MI') AS "appaireLe",
           to_char(e."derniereVue" AT TIME ZONE 'UTC' AT TIME ZONE g.fuseau, 'DD/MM/YYYY HH24:MI') AS "derniereVue"
    FROM "EcranAppareil" e JOIN "Eglise" g ON g.id = e."egliseId"
    WHERE e."egliseId" = ${admin.egliseId}
    ORDER BY e."creeLe" DESC, e.id`;
}

/** Revokes a screen of the admin's church; false when missing, elsewhere or already revoked. */
export async function revoquerEcran(
  base: PrismaClient,
  admin: Admin,
  ecranId: string,
): Promise<boolean> {
  return base.$transaction(async (tx) => {
    const [revoque] = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "EcranAppareil" SET "revoqueLe" = now(), "revoquePar" = ${admin.userId}
      WHERE id = ${ecranId} AND "egliseId" = ${admin.egliseId} AND "revoqueLe" IS NULL
      RETURNING id`;
    if (!revoque) return false;
    await tx.auditPlateforme.create({
      data: {
        userId: admin.userId,
        egliseId: admin.egliseId,
        action: "ecran.revoquer",
        detail: { ecranId },
        appareil: admin.appareil,
      },
    });
    return true;
  });
}

export const LIEN_INVALIDE =
  "Ce lien n'est plus valable : demandez un nouveau lien à l'administrateur de l'église.";

export type ResultatAppairage =
  { ok: true; secret: string; nom: string } | { ok: false; message: string };

/**
 * Exchanges a pairing link for the device secret. One UPDATE … RETURNING consumes the link
 * (not yet used, not revoked, not expired, church of the address, active): two devices
 * opening the same link at the same time, only one is paired. Attempts are counted per link
 * fingerprint, then against the IP guard.
 */
export async function appairerEcran(
  base: PrismaClient,
  slug: string,
  jeton: string,
  ip: string,
): Promise<ResultatAppairage> {
  const empreinte = empreinteJeton(jeton);
  const essai = await consommerDans(base, essaisEcran(empreinte, ip), new Date());
  if (!essai.autorise) {
    const minutes = Math.max(1, Math.ceil(essai.reessayerDansMs / 60_000));
    return { ok: false, message: `Trop de tentatives. Réessayez dans ${minutes} minutes.` };
  }
  if (!FORMAT_JETON_ECRAN.test(jeton)) return { ok: false, message: LIEN_INVALIDE };

  const secret = genererSecretAppareil();
  return base.$transaction(async (tx) => {
    const [appaire] = await tx.$queryRaw<{ id: string; egliseId: string; nom: string }[]>`
      UPDATE "EcranAppareil" e
      SET "appaireLe" = now(), "appareilHash" = ${empreinteJeton(secret)}
      FROM "Eglise" g
      WHERE g.id = e."egliseId" AND g.slug = ${slug} AND g.statut = 'ACTIVE'
        AND e."jetonHash" = ${empreinte} AND e."appaireLe" IS NULL AND e."revoqueLe" IS NULL
        AND e."jetonExpireLe" > now()
      RETURNING e.id, e."egliseId", e.nom`;
    if (!appaire) return { ok: false, message: LIEN_INVALIDE };
    await tx.auditPlateforme.create({
      data: {
        userId: null,
        egliseId: appaire.egliseId,
        action: "ecran.appairer",
        detail: { ecranId: appaire.id },
      },
    });
    return { ok: true, secret, nom: appaire.nom };
  });
}

export type EcranReconnu =
  | { etat: "actif"; ecranId: string; egliseId: string; nom: string; renouveler: boolean }
  | { etat: "revoque" }
  | { etat: "inconnu" };

/**
 * The screen of a device secret, for the church of the address only: a device of church A
 * on church B's address is unknown (404). Its last view is written at most once a minute,
 * not on every refresh (decision of 2026-11-24); `renouveler` says the cookie may be renewed.
 */
export async function ecranDeLAppareil(
  base: PrismaClient,
  slug: string,
  secret: string | undefined,
): Promise<EcranReconnu> {
  if (!secret || !FORMAT_SECRET_APPAREIL.test(secret)) return { etat: "inconnu" };
  const [ecran] = await base.$queryRaw<
    { id: string; egliseId: string; nom: string; revoque: boolean }[]
  >`
    SELECT e.id, e."egliseId", e.nom, e."revoqueLe" IS NOT NULL AS revoque
    FROM "EcranAppareil" e JOIN "Eglise" g ON g.id = e."egliseId"
    WHERE e."appareilHash" = ${empreinteJeton(secret)} AND g.slug = ${slug}
      AND g.statut = 'ACTIVE'`;
  if (!ecran) return { etat: "inconnu" };
  if (ecran.revoque) return { etat: "revoque" };
  const vue = await base.$executeRaw`
    UPDATE "EcranAppareil" SET "derniereVue" = now()
    WHERE id = ${ecran.id}
      AND ("derniereVue" IS NULL OR "derniereVue" < now() - interval '1 minute')`;
  return {
    etat: "actif",
    ecranId: ecran.id,
    egliseId: ecran.egliseId,
    nom: ecran.nom,
    renouveler: vue > 0,
  };
}

export type TuileEcran = {
  matricule: string;
  type: "appel" | "infirmerie";
  lieu: string;
};

/**
 * Tiles of the call screen, read inside the screen's church (RLS): matricule and place only,
 * never a name (RG-10). Children at the infirmerie first (from the sending, decision of
 * 2026-11-24), then the parent calls, oldest first; one tile per child.
 */
export async function tuilesEcran(base: PrismaClient, egliseId: string): Promise<TuileEcran[]> {
  return withEglise(
    base,
    egliseId,
    (tx) => tx.$queryRaw<TuileEcran[]>`
      SELECT matricule, type, lieu FROM (
        SELECT e.matricule, 'infirmerie' AS type, 'Infirmerie' AS lieu, 0 AS rang,
               p."infirmerieLe" AS depuis
        FROM "Presence" p
        JOIN "Session" s ON s.id = p."sessionId"
        JOIN "Enfant" e ON e.id = p."enfantId"
        WHERE s.statut = 'OUVERTE' AND p.statut = 'INFIRMERIE' AND p."basculeVers" IS NULL
        UNION ALL
        SELECT e.matricule, 'appel', a.lieu, 1, a."creeLe"
        FROM "Appel" a
        JOIN "Presence" p ON p.id = a."presenceId"
        JOIN "Session" s ON s.id = p."sessionId"
        JOIN "Enfant" e ON e.id = p."enfantId"
        WHERE a."resoluLe" IS NULL AND s.statut = 'OUVERTE' AND p.statut <> 'INFIRMERIE'
      ) t
      ORDER BY rang, depuis, matricule`,
  );
}

// Same services with the shared platform client (pages, actions, routes): the church is the
// admin's active church, or the paired device's.
export const listerEcransEglise = (admin: Pick<ContexteEglise, "egliseId">) =>
  listerEcrans(prismaPlateforme(), admin);
export const creerEcranEglise = (admin: ContexteEglise, nom: unknown) =>
  creerEcran(prismaPlateforme(), admin, nom, env().BETTER_AUTH_URL);
export const revoquerEcranEglise = (admin: ContexteEglise, ecranId: string) =>
  revoquerEcran(prismaPlateforme(), admin, ecranId);
export const appairerEcranPublic = (slug: string, jeton: string, ip: string) =>
  appairerEcran(prismaPlateforme(), slug, jeton, ip);
export const ecranDeLAppareilPublic = (slug: string, secret: string | undefined) =>
  ecranDeLAppareil(prismaPlateforme(), slug, secret);
export const tuilesEcranPublic = (egliseId: string) => tuilesEcran(prismaPlateforme(), egliseId);
export const egliseDeLEcranPublic = (egliseId: string) =>
  egliseDeLEcran(prismaPlateforme(), egliseId);

/** Name and logo key of the screen's church (light logo first, for the dark screen). */
export async function egliseDeLEcran(
  base: PrismaClient,
  egliseId: string,
): Promise<{ nom: string; logoKey: string | null }> {
  const eglise = await base.eglise.findUniqueOrThrow({
    where: { id: egliseId },
    select: { nom: true, logoKey: true, logoClairKey: true },
  });
  return { nom: eglise.nom, logoKey: eglise.logoClairKey ?? eglise.logoKey };
}

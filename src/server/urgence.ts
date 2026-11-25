import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { CANAUX_APPEL, RESULTATS_APPEL, type CanalAppel, type ResultatAppel } from "@/lib/appels";
import { journaliser } from "@/lib/audit";
import type { ClientDeBase, ContexteEglise } from "@/lib/tenant";

/**
 * "Urgence" button (cahier §7.9, ADR 0019): the child's guardians and authorised people, one
 * touch to call (`tel:`), another for WhatsApp (`wa.me`). Every call is logged (who, when,
 * number, channel) in AppelTelephonique, append only; its result is noted once afterwards.
 * Only a number of the child's family can be logged: never a number typed on the tablet.
 */

type Auteur = Pick<ContexteEglise, "userId" | "appareil">;
type Tx = Pick<ClientDeBase, "$queryRaw" | "auditLog">;

export class UrgenceRefusee extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrgenceRefusee";
  }
}

export type ContactUrgence = {
  /** Stable key for the list. */
  cle: string;
  prenom: string;
  nom: string;
  lien: string;
  principal: boolean;
  /** "Tuteur" or "Personne autorisée". */
  qualite: "tuteur" | "autorise";
  /** E.164 numbers to call, main number first. */
  telephones: string[];
  /** E.164 WhatsApp number, if the guardian gave one. */
  whatsapp: string | null;
};

/**
 * Guardians (main contact first) then active authorised people who are not guardians, of
 * the family of this presence. Numbers come as stored (E.164, ADR 0011).
 */
export async function contactsUrgence(
  db: Pick<ClientDeBase, "$queryRaw">,
  presenceId: string,
): Promise<ContactUrgence[]> {
  const tuteurs = await db.$queryRaw<
    {
      id: string;
      prenom: string;
      nom: string;
      lien: string;
      principal: boolean;
      telephone: string | null;
      telephone2: string | null;
      whatsapp: string | null;
    }[]
  >`
    SELECT t.id, t.prenom, t.nom, t.lien, t.principal, t.telephone, t.telephone2, t.whatsapp
    FROM "Presence" p JOIN "Enfant" e ON e.id = p."enfantId"
    JOIN "Tuteur" t ON t."familleId" = e."familleId"
    WHERE p.id = ${presenceId}
    ORDER BY t.principal DESC, t.prenom, t.id`;
  const autorises = await db.$queryRaw<
    { id: string; prenom: string; nom: string; lien: string; telephone: string | null }[]
  >`
    SELECT a.id, a.prenom, a.nom, a.lien, a.telephone
    FROM "Presence" p JOIN "Enfant" e ON e.id = p."enfantId"
    JOIN "PersonneAutorisee" a ON a."familleId" = e."familleId"
    WHERE p.id = ${presenceId} AND a.actif AND a."tuteurId" IS NULL
    ORDER BY a.prenom, a.id`;
  return [
    ...tuteurs.map((t) => ({
      cle: `tuteur_${t.id}`,
      prenom: t.prenom,
      nom: t.nom,
      lien: t.lien,
      principal: t.principal,
      qualite: "tuteur" as const,
      telephones: [t.telephone, t.telephone2].filter((n): n is string => Boolean(n)),
      whatsapp: t.whatsapp,
    })),
    ...autorises.map((a) => ({
      cle: `autorise_${a.id}`,
      prenom: a.prenom,
      nom: a.nom,
      lien: a.lien,
      principal: false,
      qualite: "autorise" as const,
      telephones: a.telephone ? [a.telephone] : [],
      whatsapp: null,
    })),
  ];
}

export const schemaJournalAppel = z.object({
  presenceId: z.string().min(1),
  numero: z.string().regex(/^\+[1-9]\d{7,14}$/, "Numéro inconnu : rechargez la fiche."),
  canal: z.enum(CANAUX_APPEL),
});

/**
 * Logs a call before (or while) the tablet opens the link. The number must be one of the
 * family's: a forged request cannot log, nor make the tablet show, any other number.
 */
export async function journaliserAppel(
  tx: Tx,
  auteur: Auteur,
  saisie: unknown,
): Promise<{ appelId: string }> {
  const { presenceId, numero, canal } = schemaJournalAppel.parse(saisie);
  const [ligne] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "AppelTelephonique" (id, "egliseId", "presenceId", "enfantId", numero, canal, "userId")
    SELECT gen_random_uuid()::text, p."egliseId", p.id, p."enfantId", ${numero}, ${canal}, ${auteur.userId}
    FROM "Presence" p JOIN "Enfant" e ON e.id = p."enfantId"
    WHERE p.id = ${presenceId}
      AND (EXISTS (SELECT 1 FROM "Tuteur" t WHERE t."familleId" = e."familleId"
                     AND ${numero} IN (t.telephone, t.telephone2, t.whatsapp))
           OR EXISTS (SELECT 1 FROM "PersonneAutorisee" a WHERE a."familleId" = e."familleId"
                        AND a.actif AND a.telephone = ${numero}))
    RETURNING id`;
  if (!ligne) {
    throw new UrgenceRefusee(
      "Ce numéro n'est pas celui d'un contact de la famille. Rechargez la fiche.",
    );
  }
  // No number in the audit log (personal data): the call row keeps it.
  await journaliser(tx, auteur, {
    action: "appel.telephone",
    entite: "AppelTelephonique",
    entiteId: ligne.id,
    apres: { presenceId, canal } satisfies Prisma.InputJsonObject,
  });
  return { appelId: ligne.id };
}

export const schemaResultatAppel = z.object({
  appelId: z.string().min(1),
  resultat: z.enum(Object.keys(RESULTATS_APPEL) as [ResultatAppel, ...ResultatAppel[]], {
    message: "Choisissez le résultat de l'appel.",
  }),
});

/** Notes the result of a logged call, once (the database refuses a second one). */
export async function noterResultatAppel(
  tx: Tx,
  auteur: Auteur,
  presenceId: string,
  saisie: unknown,
): Promise<void> {
  const { appelId, resultat } = schemaResultatAppel.parse(saisie);
  const [ligne] = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "AppelTelephonique" SET resultat = ${resultat}, "resultatLe" = now()
    WHERE id = ${appelId} AND "presenceId" = ${presenceId} AND resultat IS NULL
    RETURNING id`;
  if (!ligne) {
    throw new UrgenceRefusee("Le résultat de cet appel est déjà noté. Rechargez la fiche.");
  }
  await journaliser(tx, auteur, {
    action: "appel.resultat",
    entite: "AppelTelephonique",
    entiteId: appelId,
    apres: { resultat },
  });
}

export type LigneJournalAppel = {
  id: string;
  /** "10:42", in the church's time zone (RG-12). */
  heure: string;
  numero: string;
  canal: CanalAppel;
  resultat: ResultatAppel | null;
  userId: string;
};

/** Calls logged for this presence, latest first. */
export async function journalAppels(
  db: Pick<ClientDeBase, "$queryRaw">,
  presenceId: string,
): Promise<LigneJournalAppel[]> {
  return db.$queryRaw<LigneJournalAppel[]>`
    SELECT a.id, a.numero, a.canal, a.resultat, a."userId",
           to_char(a."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE g.fuseau, 'HH24:MI') AS heure
    FROM "AppelTelephonique" a JOIN "Eglise" g ON g.id = a."egliseId"
    WHERE a."presenceId" = ${presenceId}
    ORDER BY a."createdAt" DESC, a.id DESC`;
}

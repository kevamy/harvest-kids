import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { journaliser } from "@/lib/audit";
import type { ClientDeBase, ContexteEglise } from "@/lib/tenant";
import { alertesLisibles } from "./checkin";
import { ageEnMoisRevolus } from "./checkin-regles";
import { ageLisible } from "./classes";

/**
 * Infirmerie (cahier §7.7, RG-07, ADR 0019; decisions of 2026-11-24). A child PRESENT or in
 * class is accompanied to the infirmerie (INFIRMERIE, "en route" until received); the
 * infirmerie receives them, then sends them back to class: PRESENT again, to be confirmed by a
 * member of the class (never "in class" unseen). A child sent and not received after the
 * church's delay raises a red alert. Every change locks the presence row and writes an
 * EvenementPresence and an audit entry in the same transaction; the times compared with "now"
 * are set and compared by the database.
 */

type Auteur = Pick<ContexteEglise, "userId" | "appareil">;
type Tx = Pick<ClientDeBase, "$queryRaw" | "$executeRaw" | "evenementPresence" | "auditLog">;

export class InfirmerieRefusee extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InfirmerieRefusee";
  }
}

type TypeEvenement = "infirmerie" | "infirmerie_recue" | "infirmerie_retour";

async function tracer(
  tx: Tx,
  auteur: Auteur,
  presenceId: string,
  type: TypeEvenement,
  detail: Prisma.InputJsonObject,
  avant: Prisma.InputJsonObject,
  apres: Prisma.InputJsonObject,
) {
  const evenement: Omit<Prisma.EvenementPresenceUncheckedCreateInput, "egliseId"> = {
    presenceId,
    type,
    detail,
    userId: auteur.userId,
    appareil: auteur.appareil,
  };
  // egliseId is added by the scoped client.
  await tx.evenementPresence.create({
    data: evenement as Prisma.EvenementPresenceUncheckedCreateInput,
  });
  await journaliser(tx, auteur, {
    action: `presence.${type}`,
    entite: "Presence",
    entiteId: presenceId,
    avant,
    apres,
  });
}

type Verrou = { prenom: string; statut: string; ouverte: boolean; recue: boolean };

/** Locks the presence (one change at a time, whatever the tablet); null when missing. */
async function verrouiller(tx: Tx, presenceId: string): Promise<Verrou | null> {
  const [ligne] = await tx.$queryRaw<Verrou[]>`
    SELECT e.prenom, p.statut::text AS statut, s.statut = 'OUVERTE' AS ouverte,
           p."infirmerieRecueLe" IS NOT NULL AS recue
    FROM "Presence" p
    JOIN "Enfant" e ON e.id = p."enfantId"
    JOIN "Session" s ON s.id = p."sessionId"
    WHERE p.id = ${presenceId} AND p."basculeVers" IS NULL
    FOR UPDATE OF p`;
  return ligne ?? null;
}

async function presenceOuverte(tx: Tx, presenceId: string): Promise<Verrou> {
  const presence = await verrouiller(tx, presenceId);
  if (!presence) throw new InfirmerieRefusee("Enfant introuvable dans cette session. Rechargez.");
  if (!presence.ouverte) {
    throw new InfirmerieRefusee("La session n'est plus ouverte : rien ne peut être changé.");
  }
  return presence;
}

export const schemaEnvoi = z.object({
  presenceId: z.string().min(1),
  accompagnantUserId: z.string().min(1, "Choisissez qui accompagne l'enfant."),
  motif: z
    .string({ message: "Indiquez le motif en quelques mots." })
    .trim()
    .min(3, "Indiquez le motif en quelques mots.")
    .max(200, "Le motif tient en 200 caractères au plus."),
});

/**
 * PRESENT or EN_SALLE → INFIRMERIE, "en route". `accompagnantValide` checks the companion is
 * an active member of the church (platform table, read by the caller).
 */
export async function envoyerInfirmerie(
  tx: Tx,
  auteur: Auteur,
  saisie: unknown,
  accompagnantValide: (userId: string) => Promise<boolean>,
): Promise<{ prenom: string }> {
  const { presenceId, accompagnantUserId, motif } = schemaEnvoi.parse(saisie);
  if (!(await accompagnantValide(accompagnantUserId))) {
    throw new InfirmerieRefusee("Choisissez qui accompagne l'enfant dans la liste.");
  }
  const presence = await presenceOuverte(tx, presenceId);
  if (presence.statut === "INFIRMERIE") {
    throw new InfirmerieRefusee(`${presence.prenom} est déjà à l'infirmerie.`);
  }
  if (presence.statut !== "PRESENT" && presence.statut !== "EN_SALLE") {
    throw new InfirmerieRefusee(`${presence.prenom} a déjà été récupéré.`);
  }
  await tx.$executeRaw`
    UPDATE "Presence"
    SET statut = 'INFIRMERIE', "infirmerieLe" = now(), "infirmerieRecueLe" = NULL
    WHERE id = ${presenceId}`;
  await tracer(
    tx,
    auteur,
    presenceId,
    "infirmerie",
    { statut: "INFIRMERIE", depuis: presence.statut, accompagnant: accompagnantUserId, motif },
    { statut: presence.statut },
    { statut: "INFIRMERIE", accompagnant: accompagnantUserId },
  );
  return { prenom: presence.prenom };
}

const schemaPresence = z.object({ presenceId: z.string().min(1) });

/** "En route" → received by the infirmerie. */
export async function recevoirInfirmerie(
  tx: Tx,
  auteur: Auteur,
  saisie: unknown,
): Promise<{ prenom: string }> {
  const { presenceId } = schemaPresence.parse(saisie);
  const presence = await presenceOuverte(tx, presenceId);
  if (presence.statut !== "INFIRMERIE") {
    throw new InfirmerieRefusee(`${presence.prenom} n'est plus attendu à l'infirmerie.`);
  }
  if (presence.recue) throw new InfirmerieRefusee(`${presence.prenom} est déjà reçu.`);
  await tx.$executeRaw`
    UPDATE "Presence" SET "infirmerieRecueLe" = now() WHERE id = ${presenceId}`;
  await tracer(
    tx,
    auteur,
    presenceId,
    "infirmerie_recue",
    { statut: "INFIRMERIE" },
    { statut: "INFIRMERIE", recu: false },
    { statut: "INFIRMERIE", recu: true },
  );
  return { prenom: presence.prenom };
}

/**
 * INFIRMERIE → PRESENT (decision of 2026-11-24): back in class only once a member of the
 * class confirms the arrival; the "not yet in class" delay starts again now.
 */
export async function renvoyerEnClasse(
  tx: Tx,
  auteur: Auteur,
  saisie: unknown,
): Promise<{ prenom: string }> {
  const { presenceId } = schemaPresence.parse(saisie);
  const presence = await presenceOuverte(tx, presenceId);
  if (presence.statut !== "INFIRMERIE") {
    throw new InfirmerieRefusee(`${presence.prenom} n'est pas à l'infirmerie.`);
  }
  await tx.$executeRaw`
    UPDATE "Presence"
    SET statut = 'PRESENT', "infirmerieLe" = NULL, "infirmerieRecueLe" = NULL,
        "retourInfirmerieLe" = now(), "enSalleLe" = NULL
    WHERE id = ${presenceId}`;
  await tracer(
    tx,
    auteur,
    presenceId,
    "infirmerie_retour",
    { statut: "PRESENT", recu: presence.recue },
    { statut: "INFIRMERIE" },
    { statut: "PRESENT" },
  );
  return { prenom: presence.prenom };
}

export type EnfantInfirmerie = {
  presenceId: string;
  prenom: string;
  nom: string;
  matricule: string;
  photoKey: string | null;
  classe: string;
  /** "6 ans 10 mois", at the date of the session. */
  age: string;
  alertes: string[];
  /** Minutes since the child was sent (database clock). */
  depuisMinutes: number;
  /** Sent, not yet received. */
  enRoute: boolean;
  /** En route for longer than the church's delay: red alert. */
  nonArrive: boolean;
  motif: string | null;
  accompagnantUserId: string | null;
};

/**
 * Children at the infirmerie (or on their way) in the open sessions of the church: those
 * not arrived first, then by sending time.
 */
export async function listeInfirmerie(
  db: Pick<ClientDeBase, "$queryRaw">,
  delaiReceptionMinutes: number,
): Promise<EnfantInfirmerie[]> {
  const lignes = await db.$queryRaw<
    (Omit<EnfantInfirmerie, "alertes" | "age"> & {
      alertes: string[];
      alerteDetail: string | null;
      dateNaissance: Date;
      date: Date;
    })[]
  >`
    SELECT p.id AS "presenceId", e.prenom, e.nom, e.matricule, e."photoKey", k.nom AS classe,
           e."dateNaissance", s.date,
           COALESCE(e.alertes, '{}') AS alertes, e."alerteDetail",
           floor(extract(epoch FROM now() - p."infirmerieLe") / 60)::int AS "depuisMinutes",
           p."infirmerieRecueLe" IS NULL AS "enRoute",
           (p."infirmerieRecueLe" IS NULL
             AND p."infirmerieLe" < now() - make_interval(mins => ${delaiReceptionMinutes}::int))
             AS "nonArrive",
           envoi.detail ->> 'motif' AS motif,
           envoi.detail ->> 'accompagnant' AS "accompagnantUserId"
    FROM "Presence" p
    JOIN "Session" s ON s.id = p."sessionId"
    JOIN "Enfant" e ON e.id = p."enfantId"
    JOIN "Classe" k ON k.id = p."classeId"
    LEFT JOIN LATERAL (
      SELECT ev.detail FROM "EvenementPresence" ev
      WHERE ev."presenceId" = p.id AND ev.type = 'infirmerie'
      ORDER BY ev."createdAt" DESC, ev.id DESC LIMIT 1
    ) envoi ON true
    WHERE s.statut = 'OUVERTE' AND p.statut = 'INFIRMERIE' AND p."basculeVers" IS NULL
    ORDER BY "nonArrive" DESC, p."infirmerieLe", e.prenom`;
  return lignes.map(({ alerteDetail, alertes, dateNaissance, date, ...l }) => ({
    ...l,
    age: ageLisible(ageEnMoisRevolus(dateNaissance, date)),
    alertes: alertesLisibles({ alertes, alerteDetail }),
  }));
}

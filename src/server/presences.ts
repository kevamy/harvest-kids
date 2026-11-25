import "server-only";
import type { ClientDeBase } from "@/lib/tenant";
import { alertesLisibles } from "./checkin";
import { ageEnMoisRevolus } from "./checkin-regles";
import { ageLisible } from "./classes";

/**
 * Card of a child's presence in a session (lot 3, ADR 0019): opened from the class list, the
 * infirmerie page and the reception alerts. Who sees it is decided by droitsPresence
 * (lib/rbac.ts), from the roles and the assignment to the child's class in that session.
 */

export type StatutFiche = "PRESENT" | "EN_SALLE" | "INFIRMERIE" | "RECUPERE";

export type FichePresence = {
  presenceId: string;
  sessionId: string;
  sessionClasseId: string | null;
  sessionOuverte: boolean;
  culte: string | null;
  classe: string;
  statut: StatutFiche;
  prenom: string;
  nom: string;
  matricule: string;
  photoKey: string | null;
  familleId: string;
  /** "6 ans 10 mois", at the date of the session. */
  age: string;
  /** Medical alerts, always shown. */
  alertes: string[];
  /** Minutes since the child was sent to the infirmerie (database clock), when there. */
  infirmerieDepuisMinutes: number | null;
  /** Sent but not yet received by the infirmerie. */
  enRoute: boolean;
};

/** A presence of the active church; null when missing (or in another church). */
export async function fichePresence(
  db: Pick<ClientDeBase, "$queryRaw">,
  presenceId: string,
): Promise<FichePresence | null> {
  const [ligne] = await db.$queryRaw<
    (Omit<FichePresence, "age" | "alertes"> & {
      dateNaissance: Date;
      date: Date;
      alertes: string[];
      alerteDetail: string | null;
    })[]
  >`
    SELECT p.id AS "presenceId", p."sessionId", sc.id AS "sessionClasseId",
           s.statut = 'OUVERTE' AS "sessionOuverte", c.nom AS culte, k.nom AS classe,
           p.statut::text AS statut, e.prenom, e.nom, e.matricule, e."photoKey", e."familleId",
           e."dateNaissance", s.date, COALESCE(e.alertes, '{}') AS alertes, e."alerteDetail",
           CASE WHEN p."infirmerieLe" IS NULL THEN NULL
                ELSE floor(extract(epoch FROM now() - p."infirmerieLe") / 60)::int END
             AS "infirmerieDepuisMinutes",
           (p."infirmerieLe" IS NOT NULL AND p."infirmerieRecueLe" IS NULL) AS "enRoute"
    FROM "Presence" p
    JOIN "Session" s ON s.id = p."sessionId"
    JOIN "Enfant" e ON e.id = p."enfantId"
    JOIN "Classe" k ON k.id = p."classeId"
    LEFT JOIN "Culte" c ON c.id = s."culteId"
    LEFT JOIN "SessionClasse" sc ON sc."sessionId" = p."sessionId" AND sc."classeId" = p."classeId"
    WHERE p.id = ${presenceId}`;
  if (!ligne) return null;
  const { dateNaissance, date, alertes, alerteDetail, ...fiche } = ligne;
  return {
    ...fiche,
    age: ageLisible(ageEnMoisRevolus(dateNaissance, date)),
    alertes: alertesLisibles({ alertes, alerteDetail }),
  };
}

/**
 * Whether the member is assigned now (no departure) to the class of this presence in its
 * session: a MONITEUR only reaches the children of their class.
 */
export async function affecteALaPresence(
  db: Pick<ClientDeBase, "$queryRaw">,
  presenceId: string,
  membreId: string,
): Promise<boolean> {
  const [ligne] = await db.$queryRaw<{ affecte: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM "Presence" p
      JOIN "SessionClasse" sc ON sc."sessionId" = p."sessionId" AND sc."classeId" = p."classeId"
      JOIN "AffectationMoniteur" a ON a."sessionClasseId" = sc.id
      WHERE p.id = ${presenceId} AND a."membreId" = ${membreId} AND a.depart IS NULL
    ) AS affecte`;
  return ligne?.affecte ?? false;
}

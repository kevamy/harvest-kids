import "server-only";
import { journaliser } from "@/lib/audit";
import type { ClientDeBase, ContexteEglise } from "@/lib/tenant";
import type { StatutSession } from "@/generated/prisma/enums";

/**
 * Sessions of a church (cahier §7.2): the dated occurrence of a service. Today's sessions are
 * created on demand from the active services, with the day and hours of the church (RG-12),
 * computed by PostgreSQL: one clock. Opening and closing are done by a RESPONSABLE; the
 * justified closing and the move to the next session come with lot 4.
 */

type Auteur = Pick<ContexteEglise, "userId" | "appareil">;
type Tx = Pick<ClientDeBase, "auditLog" | "$queryRaw" | "$executeRaw">;

export class SessionRefusee extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionRefusee";
  }
}

/**
 * Creates today's sessions of the active church's active services, at most once each
 * (unique church, service, date). Returns the number created. Safe to call on every visit.
 */
export function assurerSessionsDuJour(db: Pick<ClientDeBase, "$executeRaw">): Promise<number> {
  // "Eglise" is a platform table (no RLS); the services are limited to the active church.
  return db.$executeRaw`
    INSERT INTO "Session" (id, "egliseId", "culteId", date, debut, fin)
    SELECT gen_random_uuid()::text, c."egliseId", c.id, j.jour,
           ((j.jour + c."heureDebut"::time) AT TIME ZONE e.fuseau) AT TIME ZONE 'UTC',
           ((j.jour + c."heureFin"::time) AT TIME ZONE e.fuseau) AT TIME ZONE 'UTC'
    FROM "Culte" c
    JOIN "Eglise" e ON e.id = c."egliseId"
    CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE e.fuseau)::date AS jour) j
    WHERE c.actif AND c.jour = extract(dow FROM j.jour)
    ON CONFLICT ("egliseId", "culteId", date) DO NOTHING`;
}

export type SessionDuJour = {
  id: string;
  culte: string | null;
  debut: Date;
  fin: Date;
  /** "08:00": start and end in the church's local time (RG-12). */
  heureDebut: string;
  heureFin: string;
  statut: StatutSession;
};

/** Today's sessions of the active church (its own day), by start time. */
export function listerSessionsDuJour(db: Pick<ClientDeBase, "$queryRaw">) {
  return db.$queryRaw<SessionDuJour[]>`
    SELECT s.id, c.nom AS culte, s.debut, s.fin, s.statut,
           to_char((s.debut AT TIME ZONE 'UTC') AT TIME ZONE e.fuseau, 'HH24:MI') AS "heureDebut",
           to_char((s.fin AT TIME ZONE 'UTC') AT TIME ZONE e.fuseau, 'HH24:MI') AS "heureFin"
    FROM "Session" s
    JOIN "Eglise" e ON e.id = s."egliseId"
    LEFT JOIN "Culte" c ON c.id = s."culteId"
    WHERE s.date = (now() AT TIME ZONE e.fuseau)::date
    ORDER BY s.debut, c.nom`;
}

/** Locks the session row and returns its status (null: not in the active church). */
export async function verrouillerSession(
  tx: Pick<ClientDeBase, "$queryRaw">,
  sessionId: string,
): Promise<StatutSession | null> {
  const [ligne] = await tx.$queryRaw<{ statut: StatutSession }[]>`
    SELECT statut FROM "Session" WHERE id = ${sessionId} FOR UPDATE`;
  return ligne?.statut ?? null;
}

/**
 * Opens a planned session: its active classes are listed for the monitors (closed until
 * they have their minimum, RG-05). Returns false when the session is not in the church.
 */
export async function ouvrirSession(tx: Tx, auteur: Auteur, sessionId: string): Promise<boolean> {
  const statut = await verrouillerSession(tx, sessionId);
  if (!statut) return false;
  if (statut === "OUVERTE") throw new SessionRefusee("Cette session est déjà ouverte.");
  if (statut === "CLOTUREE") throw new SessionRefusee("Cette session est clôturée.");
  await tx.$executeRaw`UPDATE "Session" SET statut = 'OUVERTE' WHERE id = ${sessionId}`;
  await tx.$executeRaw`
    INSERT INTO "SessionClasse" (id, "egliseId", "sessionId", "classeId")
    SELECT gen_random_uuid()::text, k."egliseId", ${sessionId}, k.id
    FROM "Classe" k WHERE k.active
    ON CONFLICT ("sessionId", "classeId") DO NOTHING`;
  await journaliser(tx, auteur, {
    action: "session.ouverte",
    entite: "Session",
    entiteId: sessionId,
    avant: { statut },
    apres: { statut: "OUVERTE" },
  });
  return true;
}

/**
 * Closes an open session once every child has been collected (RG-08); the monitors still
 * in a class leave it. A justified closing with children still present comes with lot 4.
 */
export async function cloturerSession(tx: Tx, auteur: Auteur, sessionId: string): Promise<boolean> {
  const statut = await verrouillerSession(tx, sessionId);
  if (!statut) return false;
  if (statut !== "OUVERTE") throw new SessionRefusee("Seule une session ouverte se clôture.");
  const [ligne] = await tx.$queryRaw<{ restants: number }[]>`
    SELECT count(*)::int AS restants FROM "Presence"
    WHERE "sessionId" = ${sessionId} AND statut <> 'RECUPERE' AND "basculeVers" IS NULL`;
  const restants = ligne?.restants ?? 0;
  if (restants > 0) {
    throw new SessionRefusee(
      restants === 1
        ? "Un enfant n'est pas encore récupéré : remettez-le à ses parents avant de clôturer."
        : `${restants} enfants ne sont pas encore récupérés : remettez-les à leurs parents avant de clôturer.`,
    );
  }
  const departs = await tx.$executeRaw`
    UPDATE "AffectationMoniteur" a SET depart = now()
    FROM "SessionClasse" sc
    WHERE sc.id = a."sessionClasseId" AND sc."sessionId" = ${sessionId} AND a.depart IS NULL`;
  await tx.$executeRaw`UPDATE "Session" SET statut = 'CLOTUREE' WHERE id = ${sessionId}`;
  await journaliser(tx, auteur, {
    action: "session.cloturee",
    entite: "Session",
    entiteId: sessionId,
    avant: { statut },
    apres: { statut: "CLOTUREE", moniteursSortis: departs },
  });
  return true;
}

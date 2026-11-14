import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { journaliser } from "@/lib/audit";
import type { ClientDeBase, ContexteEglise } from "@/lib/tenant";
import { MESSAGES_SCAN, resoudreJeton, type VerificationMoniteur } from "./cartes/resolution";
import { alertesLisibles } from "./checkin";
import { ageEnMoisRevolus } from "./checkin-regles";
import { ageLisible } from "./classes";

/**
 * Arrival in class (cahier §7.4, ADR 0015). The list of a class in a session shows the
 * children to confirm (PRESENT) above those in class (EN_SALLE). The members assigned to the
 * class confirm by a touch or a scan; a scan only reads the card (a pending card finds the
 * family without being activated). A confirmation can be undone: for 1 minute by the member
 * who made it, afterwards only by a RESPONSABLE with a reason. Every change of status writes
 * an EvenementPresence and an audit entry in the same transaction; the dates compared with
 * "now" (confirmation, delay, check-in wait) are set and compared by the database.
 */

type Auteur = Pick<ContexteEglise, "userId" | "appareil">;
type Lecture = Pick<ClientDeBase, "carteFamille" | "badgeMoniteur" | "$queryRaw">;
type Tx = Lecture & Pick<ClientDeBase, "evenementPresence" | "auditLog" | "$executeRaw">;

/** Undoing one's own confirmation without a reason is possible for this long (cahier §7.4). */
export const DELAI_ANNULATION_SECONDES = 60;

export class SalleRefusee extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalleRefusee";
  }
}

export type ClasseDeSession = {
  sessionClasseId: string;
  sessionId: string;
  classeId: string;
  nom: string;
  salle: string | null;
  culte: string | null;
  sessionOuverte: boolean;
  /** The church's local day of the session (ages in completed months, RG-17). */
  date: Date;
};

/** A class in a session, by its SessionClasse id; null when missing (or in another church). */
export async function classeDeSession(
  db: Pick<ClientDeBase, "$queryRaw">,
  sessionClasseId: string,
): Promise<ClasseDeSession | null> {
  const [ligne] = await db.$queryRaw<ClasseDeSession[]>`
    SELECT sc.id AS "sessionClasseId", sc."sessionId", sc."classeId", k.nom, k.salle,
           c.nom AS culte, s.statut = 'OUVERTE' AS "sessionOuverte", s.date
    FROM "SessionClasse" sc
    JOIN "Session" s ON s.id = sc."sessionId"
    JOIN "Classe" k ON k.id = sc."classeId"
    LEFT JOIN "Culte" c ON c.id = s."culteId"
    WHERE sc.id = ${sessionClasseId}`;
  return ligne ?? null;
}

/** Whether the member is assigned to this class of the session now (no departure). */
export async function estAffecte(
  db: Pick<ClientDeBase, "$queryRaw">,
  sessionClasseId: string,
  membreId: string,
): Promise<boolean> {
  const [ligne] = await db.$queryRaw<{ affecte: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM "AffectationMoniteur"
      WHERE "sessionClasseId" = ${sessionClasseId} AND "membreId" = ${membreId}
        AND depart IS NULL
    ) AS affecte`;
  return ligne?.affecte ?? false;
}

export type EnfantSalle = {
  presenceId: string;
  prenom: string;
  nom: string;
  matricule: string;
  photoKey: string | null;
  /** "6 ans 10 mois", at the date of the session. */
  age: string;
  /** Medical alerts, always shown in the class list. */
  alertes: string[];
  statut: "PRESENT" | "EN_SALLE" | "INFIRMERIE";
  /** Minutes since the check-in (database clock). */
  attenteMinutes: number;
  /** Still PRESENT after the church's delay: "not arrived in class" alert. */
  enRetard: boolean;
  /** Confirmed by the reader less than a minute ago: they may undo it without a reason. */
  annulable: boolean;
};

/** Children of a class in a session: infirmary first (RG-07), then to confirm, then in class. */
export async function listeDeClasse(
  db: Pick<ClientDeBase, "$queryRaw">,
  classe: ClasseDeSession,
  lecteurUserId: string,
  delaiNonArriveMinutes: number,
): Promise<EnfantSalle[]> {
  const lignes = await db.$queryRaw<
    (Omit<EnfantSalle, "age" | "alertes"> & {
      dateNaissance: Date;
      alertes: string[];
      alerteDetail: string | null;
    })[]
  >`
    SELECT p.id AS "presenceId", e.prenom, e.nom, e.matricule, e."photoKey",
           e."dateNaissance", e.alertes, e."alerteDetail", p.statut::text AS statut,
           floor(extract(epoch FROM now() - p."checkinLe") / 60)::int AS "attenteMinutes",
           (p.statut = 'PRESENT'
             AND p."checkinLe" < now() - make_interval(mins => ${delaiNonArriveMinutes}::int))
             AS "enRetard",
           (p.statut = 'EN_SALLE'
             AND p."enSalleLe" > now() - make_interval(secs => ${DELAI_ANNULATION_SECONDES}::int)
             AND confirmation."userId" IS NOT DISTINCT FROM ${lecteurUserId})
             AS annulable
    FROM "Presence" p
    JOIN "Enfant" e ON e.id = p."enfantId"
    LEFT JOIN LATERAL (
      SELECT ev."userId" FROM "EvenementPresence" ev
      WHERE ev."presenceId" = p.id AND ev.type = 'en_salle'
      ORDER BY ev."createdAt" DESC, ev.id DESC LIMIT 1
    ) confirmation ON true
    WHERE p."sessionId" = ${classe.sessionId} AND p."classeId" = ${classe.classeId}
      AND p.statut IN ('PRESENT', 'EN_SALLE', 'INFIRMERIE') AND p."basculeVers" IS NULL
    ORDER BY p.statut = 'INFIRMERIE' DESC, p.statut = 'PRESENT' DESC, p."checkinLe", e.prenom`;
  return lignes.map(({ dateNaissance, alertes, alerteDetail, ...l }) => ({
    ...l,
    age: ageLisible(ageEnMoisRevolus(dateNaissance, classe.date)),
    alertes: alertesLisibles({ alertes, alerteDetail }),
  }));
}

/** The session must be open, and the author assigned to the class (confirmations). */
async function verifierConfirmation(
  tx: Pick<ClientDeBase, "$queryRaw">,
  classe: ClasseDeSession,
  membreId: string,
) {
  if (!classe.sessionOuverte) {
    throw new SalleRefusee("La session n'est plus ouverte : rien ne peut être confirmé.");
  }
  if (!(await estAffecte(tx, classe.sessionClasseId, membreId))) {
    throw new SalleRefusee(
      "Seuls les membres affectés à cette classe confirment les arrivées. Rejoignez la classe d'abord.",
    );
  }
}

/** One status change: its EvenementPresence and its audit entry, in the caller's transaction. */
async function tracer(
  tx: Tx,
  auteur: Auteur,
  presenceId: string,
  type: "en_salle" | "en_salle_annulee",
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
    action: type === "en_salle" ? "presence.en_salle" : "presence.en_salle_annulee",
    entite: "Presence",
    entiteId: presenceId,
    avant,
    apres,
  });
}

export type ResultatConfirmation = {
  /** First names of the children confirmed now. */
  confirmes: string[];
  /** First names of the children already in class (another tablet, or a second touch). */
  dejaEnSalle: string[];
};

/**
 * PRESENT → EN_SALLE for the given presences of this class. The UPDATE only takes children
 * still PRESENT in this class: a confirmation made at the same time on another tablet
 * updates nothing more, and writes no second event.
 */
async function confirmer(
  tx: Tx,
  auteur: Auteur,
  classe: ClasseDeSession,
  presenceIds: string[],
  mode: "toucher" | "scan",
): Promise<ResultatConfirmation> {
  const confirmes = await tx.$queryRaw<{ id: string; prenom: string }[]>`
    UPDATE "Presence" p SET statut = 'EN_SALLE', "enSalleLe" = now()
    FROM "Enfant" e
    WHERE e.id = p."enfantId" AND p.id = ANY(${presenceIds}::text[])
      AND p."sessionId" = ${classe.sessionId} AND p."classeId" = ${classe.classeId}
      AND p.statut = 'PRESENT' AND p."basculeVers" IS NULL
    RETURNING p.id, e.prenom`;
  for (const { id } of confirmes) {
    await tracer(
      tx,
      auteur,
      id,
      "en_salle",
      { statut: "EN_SALLE", classeId: classe.classeId, mode },
      { statut: "PRESENT" },
      { statut: "EN_SALLE" },
    );
  }
  const restants = presenceIds.filter((id) => !confirmes.some((c) => c.id === id));
  const dejaEnSalle =
    restants.length === 0
      ? []
      : await tx.$queryRaw<{ prenom: string }[]>`
          SELECT e.prenom FROM "Presence" p JOIN "Enfant" e ON e.id = p."enfantId"
          WHERE p.id = ANY(${restants}::text[]) AND p."sessionId" = ${classe.sessionId}
            AND p."classeId" = ${classe.classeId} AND p.statut = 'EN_SALLE'
          ORDER BY e.prenom`;
  if (confirmes.length === 0 && dejaEnSalle.length === 0) {
    throw new SalleRefusee(
      "Cet enfant n'est pas attendu dans cette classe. Vérifiez sa classe à l'accueil.",
    );
  }
  return {
    confirmes: confirmes.map((c) => c.prenom),
    dejaEnSalle: dejaEnSalle.map((d) => d.prenom),
  };
}

const schemaPresence = z.object({ presenceId: z.string().min(1) });

/** Confirmation by a touch on the child's line. */
export async function confirmerParToucher(
  tx: Tx,
  auteur: Auteur & Pick<ContexteEglise, "membreId">,
  classe: ClasseDeSession,
  saisie: unknown,
): Promise<ResultatConfirmation> {
  const { presenceId } = schemaPresence.parse(saisie);
  await verifierConfirmation(tx, classe, auteur.membreId);
  return confirmer(tx, auteur, classe, [presenceId], "toucher");
}

/**
 * Confirmation by a scan: a family card confirms the family's children expected in this
 * class, a child card that child only (RG-16). The card is only read: a pending card finds
 * the family and stays pending (activation belongs to check-in and check-out).
 */
export async function confirmerParScan(
  tx: Tx,
  auteur: Auteur & Pick<ContexteEglise, "membreId">,
  verifier: VerificationMoniteur,
  classe: ClasseDeSession,
  jeton: string,
): Promise<ResultatConfirmation> {
  await verifierConfirmation(tx, classe, auteur.membreId);
  const resolution = await resoudreJeton(tx, jeton.trim(), verifier);
  if (resolution.statut !== "active" && resolution.statut !== "en_attente") {
    throw new SalleRefusee(MESSAGES_SCAN[resolution.statut]);
  }
  if (resolution.type === "badge") {
    throw new SalleRefusee(
      "C'est un badge moniteur : scannez la carte de l'enfant ou de la famille.",
    );
  }
  const presences = await tx.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM "Presence" p JOIN "Enfant" e ON e.id = p."enfantId"
    WHERE p."sessionId" = ${classe.sessionId} AND p."classeId" = ${classe.classeId}
      AND p.statut IN ('PRESENT', 'EN_SALLE') AND p."basculeVers" IS NULL
      AND e."familleId" = ${resolution.familleId}
      AND (${resolution.enfantId}::text IS NULL OR e.id = ${resolution.enfantId}::text)`;
  if (presences.length === 0) {
    throw new SalleRefusee(
      resolution.enfantId
        ? "Cet enfant n'est pas attendu dans cette classe. Vérifiez sa classe à l'accueil."
        : "Aucun enfant de cette famille n'est attendu dans cette classe. Vérifiez à l'accueil.",
    );
  }
  return confirmer(
    tx,
    auteur,
    classe,
    presences.map((p) => p.id),
    "scan",
  );
}

export const schemaAnnulation = z.object({
  presenceId: z.string().min(1),
  motif: z
    .string()
    .trim()
    .max(300, "Le motif tient en 300 caractères au plus.")
    .optional()
    .transform((m) => m || undefined),
});

/**
 * EN_SALLE → PRESENT. Within 1 minute of the confirmation (database clock), its author
 * undoes it without a reason; afterwards, or for someone else's confirmation, only a
 * RESPONSABLE corrects it, with a reason. The presence row is locked: an undo and a
 * correction made at the same time change it once.
 */
export async function annulerEnSalle(
  tx: Tx,
  auteur: Auteur,
  classe: ClasseDeSession,
  peutCorriger: boolean,
  saisie: unknown,
): Promise<{ prenom: string }> {
  const { presenceId, motif } = schemaAnnulation.parse(saisie);
  if (!classe.sessionOuverte) {
    throw new SalleRefusee("La session n'est plus ouverte : rien ne peut être annulé.");
  }
  const [presence] = await tx.$queryRaw<
    { prenom: string; statut: string; dansLeDelai: boolean; confirmePar: string | null }[]
  >`
    SELECT e.prenom, p.statut::text AS statut,
           p."enSalleLe" > now() - make_interval(secs => ${DELAI_ANNULATION_SECONDES}::int)
             AS "dansLeDelai",
           (SELECT ev."userId" FROM "EvenementPresence" ev
             WHERE ev."presenceId" = p.id AND ev.type = 'en_salle'
             ORDER BY ev."createdAt" DESC, ev.id DESC LIMIT 1) AS "confirmePar"
    FROM "Presence" p JOIN "Enfant" e ON e.id = p."enfantId"
    WHERE p.id = ${presenceId} AND p."sessionId" = ${classe.sessionId}
      AND p."classeId" = ${classe.classeId}
    FOR UPDATE OF p`;
  if (!presence) {
    throw new SalleRefusee("Cet enfant n'est pas dans cette classe. Rechargez la page.");
  }
  if (presence.statut !== "EN_SALLE") {
    throw new SalleRefusee(`${presence.prenom} n'est pas en salle : il n'y a rien à annuler.`);
  }
  const sienne = presence.dansLeDelai && presence.confirmePar === auteur.userId;
  if (!sienne) {
    if (!peutCorriger) {
      throw new SalleRefusee(
        "Le délai d'une minute est passé : seul le responsable peut corriger cette arrivée.",
      );
    }
    if (!motif || motif.length < 3) {
      throw new SalleRefusee("Indiquez le motif de la correction, puis recommencez.");
    }
  }
  await tx.$executeRaw`
    UPDATE "Presence" SET statut = 'PRESENT', "enSalleLe" = NULL WHERE id = ${presenceId}`;
  const correction = sienne ? {} : { motif: motif! };
  await tracer(
    tx,
    auteur,
    presenceId,
    "en_salle_annulee",
    { statut: "PRESENT", par: sienne ? "auteur" : "responsable", ...correction },
    { statut: "EN_SALLE" },
    { statut: "PRESENT", ...correction },
  );
  return { prenom: presence.prenom };
}

export type AlerteNonArrive = {
  presenceId: string;
  prenom: string;
  matricule: string;
  classe: string;
  minutes: number;
};

/**
 * Children still PRESENT after the church's delay in an open session (cahier §7.4): the
 * "not arrived in class" alert of the reception dashboard. Compared with the database clock.
 */
export async function alertesNonArrives(
  db: Pick<ClientDeBase, "$queryRaw">,
  delaiMinutes: number,
): Promise<AlerteNonArrive[]> {
  return db.$queryRaw<AlerteNonArrive[]>`
    SELECT p.id AS "presenceId", e.prenom, e.matricule, k.nom AS classe,
           floor(extract(epoch FROM now() - p."checkinLe") / 60)::int AS minutes
    FROM "Presence" p
    JOIN "Session" s ON s.id = p."sessionId"
    JOIN "Enfant" e ON e.id = p."enfantId"
    JOIN "Classe" k ON k.id = p."classeId"
    WHERE s.statut = 'OUVERTE' AND p.statut = 'PRESENT' AND p."basculeVers" IS NULL
      AND p."checkinLe" < now() - make_interval(mins => ${delaiMinutes}::int)
    ORDER BY p."checkinLe", e.prenom`;
}

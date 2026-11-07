import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { journaliser } from "@/lib/audit";
import type { ClientDeBase, ContexteEglise } from "@/lib/tenant";
import { activerAuPremierScan } from "./cartes/cycle";
import { MESSAGES_SCAN, resoudreJeton, type VerificationMoniteur } from "./cartes/resolution";
import {
  ageEnMoisRevolus,
  classeProposee,
  genererCodeRetrait,
  type ClasseProposee,
} from "./checkin-regles";
import { ageLisible } from "./classes";
import { ALERTES_RAPIDES } from "./familles";
import { verrouillerSession } from "./sessions";

/**
 * Check-in at the reception desk (cahier §7.3, RG-04, RG-05, RG-08, RG-16, RG-17). The scan
 * only reads (resoudreJeton): the screen shows the family's children with their proposed
 * class. Validating writes, in one transaction: the pending card scanned is activated
 * (activerAuPremierScan, first scan), each child becomes PRESENT in an open class with the
 * family's retrieval code for the session, with an EvenementPresence and an audit entry.
 * A draft family (CSV import) is refused until it is finalised.
 */

type Auteur = Pick<ContexteEglise, "userId" | "appareil">;
type Lecture = Pick<
  ClientDeBase,
  "famille" | "enfant" | "classe" | "sessionClasse" | "carteFamille" | "badgeMoniteur" | "$queryRaw"
>;
type Tx = Lecture &
  Pick<ClientDeBase, "presence" | "evenementPresence" | "auditLog" | "$executeRaw">;

export class CheckinRefuse extends Error {
  constructor(
    message: string,
    /** A draft family: the screen links to its record to finalise it. */
    readonly brouillonId: string | null = null,
  ) {
    super(message);
    this.name = "CheckinRefuse";
  }
}

const MESSAGE_BROUILLON =
  "Famille à compléter : finalisez l'inscription avant le check-in (matricules, photos, consentement).";

export type EnfantCheckin = {
  id: string;
  prenom: string;
  nom: string;
  matricule: string;
  photoKey: string | null;
  ageMois: number;
  /** "4 ans 2 mois". */
  age: string;
  /** Medical alerts, readable ("Allergie alimentaire · arachides"), or null. */
  alerte: string | null;
  classe: ClasseProposee;
  /** Preselected: every child for a family card, the scanned child for a child card. */
  coche: boolean;
  /** Already checked in: in this session, or still in another one (RG-08). */
  dejaPresent: "cette_session" | "autre_session" | null;
};

export type PreparationCheckin = {
  famille: { id: string; nom: string };
  carte: { type: "famille" | "enfant"; enAttente: boolean } | null;
  classes: { id: string; nom: string; salle: string | null; ouverte: boolean }[];
  enfants: EnfantCheckin[];
};

const LIBELLE_ALERTE = new Map<string, string>(ALERTES_RAPIDES.map((a) => [a.code, a.libelle]));

/** Medical alerts as shown on the family record, recalled at check-in (cahier §7.3.6). */
function alerteLisible(e: { alertes: string[]; alerteDetail: string | null }): string | null {
  const parties = [...e.alertes.map((a) => LIBELLE_ALERTE.get(a) ?? a), e.alerteDetail];
  return parties.filter(Boolean).join(" · ") || null;
}

/** The session must be open; returns its date (the church's local day). */
async function dateSessionOuverte(db: Pick<ClientDeBase, "$queryRaw">, sessionId: string) {
  const [session] = await db.$queryRaw<{ statut: string; date: Date }[]>`
    SELECT statut, date FROM "Session" WHERE id = ${sessionId}`;
  if (!session) throw new CheckinRefuse("Session introuvable. Rechargez la page.");
  if (session.statut !== "OUVERTE") {
    throw new CheckinRefuse("La session n'est pas ouverte : demandez au responsable de l'ouvrir.");
  }
  return session.date;
}

/** The family and child designated by a scanned card, or the scan's refusal message. */
async function carteScannee(db: Lecture, jeton: string, verifier: VerificationMoniteur) {
  const resolution = await resoudreJeton(db, jeton, verifier);
  if (resolution.statut === "active" || resolution.statut === "en_attente") {
    if (resolution.type === "badge") {
      throw new CheckinRefuse("C'est un badge moniteur : scannez la carte de la famille.");
    }
    return resolution;
  }
  throw new CheckinRefuse(MESSAGES_SCAN[resolution.statut]);
}

/** Read-only: what the check-in screen shows after a scan or a search. */
export async function preparerCheckin(
  db: Lecture,
  verifier: VerificationMoniteur,
  saisie: { sessionId: string } & ({ jeton: string } | { familleId: string }),
): Promise<PreparationCheckin> {
  const jourSession = await dateSessionOuverte(db, saisie.sessionId);
  let carte: PreparationCheckin["carte"] = null;
  let familleId: string;
  let enfantScanne: string | null = null;
  if ("jeton" in saisie) {
    const scan = await carteScannee(db, saisie.jeton, verifier);
    familleId = scan.familleId;
    enfantScanne = scan.enfantId;
    carte = { type: scan.type, enAttente: scan.statut === "en_attente" };
  } else {
    familleId = saisie.familleId;
  }

  const famille = await db.famille.findUnique({
    where: { id: familleId },
    select: { id: true, nom: true, finaliseeLe: true },
  });
  if (!famille) throw new CheckinRefuse("Famille introuvable. Recherchez-la de nouveau.");
  if (!famille.finaliseeLe) throw new CheckinRefuse(MESSAGE_BROUILLON, famille.id);

  const [enfants, classes, sessionClasses] = await Promise.all([
    db.enfant.findMany({
      where: { familleId, actif: true, matricule: { not: null } },
      // Eldest first, as on the family record.
      orderBy: [{ dateNaissance: "asc" }, { prenom: "asc" }],
      select: {
        id: true,
        prenom: true,
        nom: true,
        matricule: true,
        photoKey: true,
        dateNaissance: true,
        alertes: true,
        alerteDetail: true,
        classeForceeId: true,
      },
    }),
    db.classe.findMany({
      where: { active: true },
      orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      select: {
        id: true,
        nom: true,
        salle: true,
        ageMinMois: true,
        ageMaxMois: true,
        ordre: true,
        active: true,
      },
    }),
    db.sessionClasse.findMany({
      where: { sessionId: saisie.sessionId, ouverteLe: { not: null } },
      select: { classeId: true },
    }),
  ]);
  const ouvertes = new Set(sessionClasses.map((s) => s.classeId));
  const presences = await presencesOuvertes(
    db,
    enfants.map((e) => e.id),
  );

  return {
    famille: { id: famille.id, nom: famille.nom },
    carte,
    classes: classes.map((c) => ({
      id: c.id,
      nom: c.nom,
      salle: c.salle,
      ouverte: ouvertes.has(c.id),
    })),
    enfants: enfants.map((e) => {
      const ageMois = ageEnMoisRevolus(e.dateNaissance, jourSession);
      const ailleurs = presences.get(e.id);
      const dejaPresent = ailleurs
        ? ailleurs === saisie.sessionId
          ? ("cette_session" as const)
          : ("autre_session" as const)
        : null;
      return {
        id: e.id,
        prenom: e.prenom,
        nom: e.nom,
        matricule: e.matricule!,
        photoKey: e.photoKey,
        ageMois,
        age: ageLisible(ageMois),
        alerte: alerteLisible(e),
        classe: classeProposee({ classeForceeId: e.classeForceeId, ageMois }, classes),
        coche: !dejaPresent && (enfantScanne === null || enfantScanne === e.id),
        dejaPresent,
      };
    }),
  };
}

/** Session of each child's open presence (RG-08), by child. */
async function presencesOuvertes(db: Pick<ClientDeBase, "$queryRaw">, enfantIds: string[]) {
  if (enfantIds.length === 0) return new Map<string, string>();
  const lignes = await db.$queryRaw<{ enfantId: string; sessionId: string }[]>`
    SELECT "enfantId", "sessionId" FROM "Presence"
    WHERE "enfantId" = ANY(${enfantIds}::text[])
      AND statut <> 'RECUPERE' AND "basculeVers" IS NULL`;
  return new Map(lignes.map((l) => [l.enfantId, l.sessionId]));
}

export const schemaCheckin = z.object({
  sessionId: z.string().min(1),
  familleId: z.string().min(1),
  jeton: z.string().trim().min(1).optional(),
  enfants: z
    .array(z.object({ enfantId: z.string().min(1), classeId: z.string().min(1) }))
    .min(1, "Cochez au moins un enfant.")
    .refine((l) => new Set(l.map((e) => e.enfantId)).size === l.length, "Un enfant est en double."),
});

export type ResultatCheckin = {
  codeRetrait: string;
  enfants: { prenom: string; matricule: string; classe: string; alerte: string | null }[];
};

/** The family's code in this session if it has one (RG-04), otherwise a new unused one. */
async function codeDeLaFamille(tx: Tx, sessionId: string, familleId: string): Promise<string> {
  const [existant] = await tx.$queryRaw<{ codeRetrait: string }[]>`
    SELECT p."codeRetrait" FROM "Presence" p JOIN "Enfant" e ON e.id = p."enfantId"
    WHERE p."sessionId" = ${sessionId} AND e."familleId" = ${familleId}
    LIMIT 1`;
  if (existant) return existant.codeRetrait;
  const pris = new Set(
    (
      await tx.$queryRaw<{ codeRetrait: string }[]>`
        SELECT DISTINCT "codeRetrait" FROM "Presence" WHERE "sessionId" = ${sessionId}`
    ).map((l) => l.codeRetrait),
  );
  // 31^4 codes: a free one is found at once; the bound only guards against a bug.
  for (let essai = 0; essai < 100; essai++) {
    const code = genererCodeRetrait();
    if (!pris.has(code)) return code;
  }
  throw new Error("Aucun code de retrait libre.");
}

/**
 * Validates a check-in in one transaction (the session row is locked: check-ins of a session
 * are serialised, so two families never get the same code).
 */
export async function validerCheckin(
  tx: Tx,
  auteur: Auteur,
  verifier: VerificationMoniteur,
  saisie: unknown,
): Promise<ResultatCheckin> {
  const { sessionId, familleId, jeton, enfants: demandes } = schemaCheckin.parse(saisie);
  const statut = await verrouillerSession(tx, sessionId);
  if (!statut) throw new CheckinRefuse("Session introuvable. Rechargez la page.");
  if (statut !== "OUVERTE") {
    throw new CheckinRefuse("La session n'est pas ouverte : demandez au responsable de l'ouvrir.");
  }

  if (jeton) {
    // First check-in scan of a pending card: it becomes the family's card (ADR 0008).
    const scan = await carteScannee(tx, jeton, verifier);
    if (scan.familleId !== familleId) {
      throw new CheckinRefuse(
        "Cette carte n'est pas celle de la famille affichée. Scannez de nouveau.",
      );
    }
    if (scan.statut === "en_attente") await activerAuPremierScan(tx, auteur, jeton, verifier);
  }

  const famille = await tx.famille.findUnique({
    where: { id: familleId },
    select: { finaliseeLe: true },
  });
  if (!famille) throw new CheckinRefuse("Famille introuvable. Recherchez-la de nouveau.");
  if (!famille.finaliseeLe) throw new CheckinRefuse(MESSAGE_BROUILLON, familleId);

  const ids = demandes.map((d) => d.enfantId);
  const enfants = await tx.enfant.findMany({
    where: { id: { in: ids }, familleId, actif: true, matricule: { not: null } },
    select: { id: true, prenom: true, matricule: true, alertes: true, alerteDetail: true },
  });
  if (enfants.length !== ids.length) {
    throw new CheckinRefuse(
      "Un enfant coché n'appartient plus à cette famille. Rechargez la page.",
    );
  }
  const parId = new Map(enfants.map((e) => [e.id, e]));

  // RG-05: every class must be open (minimum of monitors, or forced by a RESPONSABLE).
  const classeIds = [...new Set(demandes.map((d) => d.classeId))];
  const classes = await tx.classe.findMany({
    where: { id: { in: classeIds }, active: true },
    select: {
      id: true,
      nom: true,
      sessionClasses: { where: { sessionId }, select: { ouverteLe: true } },
    },
  });
  for (const classeId of classeIds) {
    const classe = classes.find((c) => c.id === classeId);
    if (!classe) throw new CheckinRefuse("Classe introuvable ou inactive. Rechargez la page.");
    if (!classe.sessionClasses[0]?.ouverteLe) {
      throw new CheckinRefuse(
        `La classe ${classe.nom} n'est pas ouverte : il lui faut ses moniteurs, ou une ouverture forcée par le responsable.`,
      );
    }
  }

  // RG-08: one open presence per child.
  const ouvertes = await presencesOuvertes(tx, ids);
  for (const id of ids) {
    const session = ouvertes.get(id);
    if (!session) continue;
    const prenom = parId.get(id)!.prenom;
    throw new CheckinRefuse(
      session === sessionId
        ? `${prenom} est déjà enregistré(e) dans cette session.`
        : `${prenom} est encore enregistré(e) dans une autre session : faites d'abord son retrait.`,
    );
  }

  const codeRetrait = await codeDeLaFamille(tx, sessionId, familleId);
  const nomClasse = new Map(classes.map((c) => [c.id, c.nom]));
  for (const { enfantId, classeId } of demandes) {
    let presence: { id: string };
    try {
      presence = await tx.presence.create({
        // egliseId is added by the scoped client.
        data: {
          sessionId,
          enfantId,
          classeId,
          statut: "PRESENT",
          codeRetrait,
          checkinPar: auteur.userId,
        } as Prisma.PresenceUncheckedCreateInput,
        select: { id: true },
      });
    } catch (erreur) {
      // A concurrent check-in of the same child (RG-08, partial unique index).
      if ((erreur as { code?: unknown }).code === "P2002") {
        throw new CheckinRefuse(
          `${parId.get(enfantId)!.prenom} vient d'être enregistré(e) sur une autre tablette.`,
        );
      }
      throw erreur;
    }
    const evenement: Omit<Prisma.EvenementPresenceUncheckedCreateInput, "egliseId"> = {
      presenceId: presence.id,
      type: "checkin",
      detail: { statut: "PRESENT", classeId, carte: jeton ? "scan" : "recherche" },
      userId: auteur.userId,
      appareil: auteur.appareil,
    };
    // egliseId is added by the scoped client.
    await tx.evenementPresence.create({
      data: evenement as Prisma.EvenementPresenceUncheckedCreateInput,
    });
    await journaliser(tx, auteur, {
      action: "presence.checkin",
      entite: "Presence",
      entiteId: presence.id,
      apres: { enfantId, classeId, statut: "PRESENT" },
    });
  }

  return {
    codeRetrait,
    enfants: demandes.map(({ enfantId, classeId }) => {
      const e = parId.get(enfantId)!;
      return {
        prenom: e.prenom,
        matricule: e.matricule!,
        classe: nomClasse.get(classeId)!,
        alerte: alerteLisible(e),
      };
    }),
  };
}

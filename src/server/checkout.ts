import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { journaliser } from "@/lib/audit";
import type { ClientDeBase, ContexteEglise } from "@/lib/tenant";
import { activerAuPremierScan } from "./cartes/cycle";
import { MESSAGES_SCAN, resoudreJeton, type VerificationMoniteur } from "./cartes/resolution";
import { alertesLisibles } from "./checkin";
import { FORMAT_CODE_RETRAIT } from "./checkin-regles";
import { duPlusAgeAuPlusJeune } from "./salle";
import { verrouillerSession } from "./sessions";

/**
 * Check-out at the reception desk (cahier §7.6, RG-04, RG-06, RG-16). The parent shows the
 * card (scan) or gives the session's retrieval code; the screen shows the family's children
 * present in the session, with their status and place, and the photos of the authorised
 * persons. The agent checks the adult visually and touches their photo: a right card or code
 * never suffices alone. Validating, in one transaction: a pending card scanned is activated
 * (first scan, ADR 0008), each child handed over becomes RECUPERE with the person who
 * collected them and the agent, an EvenementPresence and an audit entry.
 */

type Auteur = Pick<ContexteEglise, "userId" | "appareil">;
type Lecture = Pick<
  ClientDeBase,
  "carteFamille" | "badgeMoniteur" | "famille" | "personneAutorisee" | "tuteur" | "$queryRaw"
>;
type Tx = Lecture &
  Pick<ClientDeBase, "evenementPresence" | "auditLog" | "reemissionCartes" | "$executeRaw">;

export class CheckoutRefuse extends Error {
  constructor(
    message: string,
    /** A wrong retrieval code: counted against the tablet's limit. */
    readonly codeErrone = false,
  ) {
    super(message);
    this.name = "CheckoutRefuse";
  }
}

export type EnfantCheckout = {
  presenceId: string;
  prenom: string;
  nom: string;
  matricule: string;
  photoKey: string | null;
  statut: "PRESENT" | "EN_SALLE" | "INFIRMERIE";
  /** Where the child is: their class, or the infirmary. */
  lieu: string;
  alertes: string[];
  /** Preselected: every child for a family card or a code, the scanned child for a child card. */
  coche: boolean;
};

export type PersonneCheckout = {
  id: string;
  prenom: string;
  nom: string;
  lien: string;
  photoKey: string;
};

export type PreparationCheckout = {
  famille: { id: string; nom: string };
  /** How the family was found: the card (with its type) or the session's retrieval code. */
  moyen: { type: "carte"; carte: "famille" | "enfant"; enAttente: boolean } | { type: "code" };
  /** Infirmary first (RG-07), then the others in the order of the family. */
  enfants: EnfantCheckout[];
  personnes: PersonneCheckout[];
  /** The main contact, to call when the adult is not among the authorised persons. */
  contact: {
    prenom: string;
    nom: string;
    telephone: string | null;
    whatsapp: string | null;
  } | null;
};

/** The session must be open (read only). */
async function sessionOuverte(db: Pick<ClientDeBase, "$queryRaw">, sessionId: string) {
  const [session] = await db.$queryRaw<{ statut: string }[]>`
    SELECT statut FROM "Session" WHERE id = ${sessionId}`;
  if (!session) throw new CheckoutRefuse("Session introuvable. Rechargez la page.");
  if (session.statut !== "OUVERTE") {
    throw new CheckoutRefuse("Cette session n'est plus ouverte : rechargez la page.");
  }
}

/** The family designated by a scanned card, or the scan's refusal. */
async function carteScannee(db: Lecture, jeton: string, verifier: VerificationMoniteur) {
  const resolution = await resoudreJeton(db, jeton, verifier);
  if (resolution.statut !== "active" && resolution.statut !== "en_attente") {
    throw new CheckoutRefuse(MESSAGES_SCAN[resolution.statut]);
  }
  if (resolution.type === "badge") {
    throw new CheckoutRefuse("C'est un badge moniteur : scannez la carte de la famille.");
  }
  return resolution;
}

/** Normalised retrieval code, or a refusal for a malformed one (not counted: a typing slip). */
export function normaliserCode(saisie: string): string {
  const code = saisie.trim().toUpperCase().replace(/\s+/g, "");
  if (!FORMAT_CODE_RETRAIT.test(code)) {
    throw new CheckoutRefuse(
      "Le code de retrait a 4 caractères (lettres et chiffres) : vérifiez-le.",
    );
  }
  return code;
}

/** The family whose children got this code in this session only (RG-04), if any. */
async function familleDuCode(
  db: Pick<ClientDeBase, "$queryRaw">,
  sessionId: string,
  code: string,
): Promise<{ familleId: string; restants: number } | null> {
  const [ligne] = await db.$queryRaw<{ familleId: string; restants: number }[]>`
    SELECT e."familleId",
           count(*) FILTER (WHERE p.statut <> 'RECUPERE' AND p."basculeVers" IS NULL)::int
             AS restants
    FROM "Presence" p JOIN "Enfant" e ON e.id = p."enfantId"
    WHERE p."sessionId" = ${sessionId} AND p."codeRetrait" = ${code}
    GROUP BY e."familleId"
    LIMIT 1`;
  return ligne ?? null;
}

/** Children of the family still in the session (not collected, not moved to another one). */
async function enfantsPresents(
  db: Pick<ClientDeBase, "$queryRaw">,
  sessionId: string,
  familleId: string,
) {
  return db.$queryRaw<
    {
      presenceId: string;
      enfantId: string;
      prenom: string;
      nom: string;
      matricule: string;
      photoKey: string | null;
      statut: EnfantCheckout["statut"];
      classe: string;
      alertes: string[];
      alerteDetail: string | null;
    }[]
  >`
    SELECT p.id AS "presenceId", e.id AS "enfantId", e.prenom, e.nom, e.matricule, e."photoKey",
           p.statut::text AS statut, k.nom AS classe,
           COALESCE(e.alertes, '{}') AS alertes, e."alerteDetail"
    FROM "Presence" p
    JOIN "Enfant" e ON e.id = p."enfantId"
    JOIN "Classe" k ON k.id = p."classeId"
    WHERE p."sessionId" = ${sessionId} AND e."familleId" = ${familleId}
      AND p.statut <> 'RECUPERE' AND p."basculeVers" IS NULL
    ORDER BY p.statut = 'INFIRMERIE' DESC, e."dateNaissance", e.prenom`;
}

/**
 * Read only: what the check-out screen shows after a scan or a code. A wrong code is
 * refused with `codeErrone`, for the caller to count it against the tablet's limit.
 */
export async function preparerCheckout(
  db: Lecture,
  verifier: VerificationMoniteur,
  saisie: { sessionId: string } & ({ jeton: string } | { code: string }),
): Promise<PreparationCheckout> {
  await sessionOuverte(db, saisie.sessionId);

  let familleId: string;
  let enfantScanne: string | null = null;
  let moyen: PreparationCheckout["moyen"];
  if ("jeton" in saisie) {
    const carte = await carteScannee(db, saisie.jeton, verifier);
    familleId = carte.familleId;
    enfantScanne = carte.enfantId;
    moyen = { type: "carte", carte: carte.type, enAttente: carte.statut === "en_attente" };
  } else {
    const trouvee = await familleDuCode(db, saisie.sessionId, normaliserCode(saisie.code));
    if (!trouvee) {
      throw new CheckoutRefuse(
        "Ce code ne correspond à aucune famille de cette session : vérifiez-le avec le parent, ou scannez sa carte.",
        true,
      );
    }
    familleId = trouvee.familleId;
    moyen = { type: "code" };
  }

  const [famille, lignes, personnes, contact] = await Promise.all([
    db.famille.findUnique({ where: { id: familleId }, select: { id: true, nom: true } }),
    enfantsPresents(db, saisie.sessionId, familleId),
    db.personneAutorisee.findMany({
      where: { familleId, actif: true },
      orderBy: [{ nom: "asc" }, { prenom: "asc" }],
      select: { id: true, prenom: true, nom: true, lien: true, photoKey: true },
    }),
    db.tuteur.findFirst({
      where: { familleId, principal: true },
      select: { prenom: true, nom: true, telephone: true, whatsapp: true },
    }),
  ]);
  if (!famille) throw new CheckoutRefuse("Famille introuvable. Scannez de nouveau.");
  if (lignes.length === 0) {
    throw new CheckoutRefuse(
      "Aucun enfant de cette famille n'est à récupérer dans cette session : ils sont déjà récupérés, ou enregistrés dans une autre session.",
    );
  }
  if (personnes.length === 0) {
    throw new CheckoutRefuse(
      "Aucune personne autorisée n'est enregistrée pour cette famille : appelez le responsable.",
    );
  }

  return {
    famille,
    moyen,
    enfants: lignes.map(({ enfantId, classe, alertes, alerteDetail, ...l }) => ({
      ...l,
      lieu: l.statut === "INFIRMERIE" ? "Infirmerie" : classe,
      alertes: alertesLisibles({ alertes, alerteDetail }),
      coche: enfantScanne === null || enfantScanne === enfantId,
    })),
    personnes,
    contact,
  };
}

export const schemaCheckout = z
  .object({
    sessionId: z.string().min(1),
    familleId: z.string().min(1),
    jeton: z.string().trim().min(1).optional(),
    code: z.string().trim().min(1).optional(),
    personneAutoriseeId: z.string().min(1, "Touchez la photo de la personne qui récupère."),
    presenceIds: z
      .array(z.string().min(1))
      .min(1, "Cochez au moins un enfant.")
      .refine((l) => new Set(l).size === l.length, "Un enfant est en double."),
  })
  .refine((s) => Boolean(s.jeton) !== Boolean(s.code), "Scannez la carte ou saisissez le code.");

export type ResultatCheckout = {
  /** First names of the children handed over. */
  enfants: string[];
  personne: { prenom: string; nom: string };
};

/**
 * Validates a check-out in one transaction. The session row is locked: a check-out and the
 * session's closing are serialised. Only children of the family still in this session are
 * handed over; a child handed over at the same time on another tablet is refused.
 */
export async function validerCheckout(
  tx: Tx,
  auteur: Auteur,
  verifier: VerificationMoniteur,
  saisie: unknown,
): Promise<ResultatCheckout> {
  const { sessionId, familleId, jeton, code, personneAutoriseeId, presenceIds } =
    schemaCheckout.parse(saisie);
  const statut = await verrouillerSession(tx, sessionId);
  if (!statut) throw new CheckoutRefuse("Session introuvable. Rechargez la page.");
  if (statut !== "OUVERTE") {
    throw new CheckoutRefuse("Cette session n'est plus ouverte : rechargez la page.");
  }

  // The card or the code is checked again: the screen may have been left open.
  let carte: "scan" | "code";
  if (jeton) {
    const scan = await carteScannee(tx, jeton, verifier);
    if (scan.familleId !== familleId) {
      throw new CheckoutRefuse(
        "Cette carte n'est pas celle de la famille affichée. Scannez de nouveau.",
      );
    }
    // First check-out scan of a pending card: it becomes the family's card (ADR 0008).
    if (scan.statut === "en_attente") await activerAuPremierScan(tx, auteur, jeton, verifier);
    carte = "scan";
  } else {
    const trouvee = await familleDuCode(tx, sessionId, normaliserCode(code!));
    if (trouvee?.familleId !== familleId) {
      throw new CheckoutRefuse(
        "Ce code n'est pas celui de la famille affichée. Recommencez.",
        true,
      );
    }
    carte = "code";
  }

  // RG-06: the person who collects is an active authorised person of this family.
  const personne = await tx.personneAutorisee.findFirst({
    where: { id: personneAutoriseeId, familleId, actif: true },
    select: { id: true, prenom: true, nom: true },
  });
  if (!personne) {
    throw new CheckoutRefuse(
      "Cette personne n'est pas autorisée pour cette famille : touchez une photo de la liste.",
    );
  }

  const remis = await tx.$queryRaw<
    { id: string; prenom: string; dateNaissance: Date; statut: string }[]
  >`
    WITH avant AS (
      SELECT p.id, p.statut FROM "Presence" p JOIN "Enfant" e ON e.id = p."enfantId"
      WHERE p.id = ANY(${presenceIds}::text[]) AND p."sessionId" = ${sessionId}
        AND e."familleId" = ${familleId} AND p.statut <> 'RECUPERE' AND p."basculeVers" IS NULL
      FOR UPDATE OF p
    )
    UPDATE "Presence" p
    SET statut = 'RECUPERE', "recupereLe" = now(), "recuperePar" = ${personne.id},
        "remisPar" = ${auteur.userId}
    FROM avant, "Enfant" e
    WHERE p.id = avant.id AND e.id = p."enfantId"
    RETURNING p.id, e.prenom, e."dateNaissance", avant.statut::text AS statut`;
  // RETURNING has no guaranteed order: sorted like the family lists, eldest first.
  remis.sort(duPlusAgeAuPlusJeune);
  if (remis.length !== presenceIds.length) {
    throw new CheckoutRefuse(
      "Un enfant coché vient d'être récupéré sur une autre tablette, ou n'est plus dans cette session. Rechargez la famille.",
    );
  }

  for (const r of remis) {
    const evenement: Omit<Prisma.EvenementPresenceUncheckedCreateInput, "egliseId"> = {
      presenceId: r.id,
      type: "checkout",
      detail: { statut: "RECUPERE", depuis: r.statut, personneAutoriseeId: personne.id, carte },
      userId: auteur.userId,
      appareil: auteur.appareil,
    };
    // egliseId is added by the scoped client.
    await tx.evenementPresence.create({
      data: evenement as Prisma.EvenementPresenceUncheckedCreateInput,
    });
    await journaliser(tx, auteur, {
      action: "presence.checkout",
      entite: "Presence",
      entiteId: r.id,
      avant: { statut: r.statut },
      apres: { statut: "RECUPERE", personneAutoriseeId: personne.id },
    });
  }

  return {
    enfants: remis.map((r) => r.prenom),
    personne: { prenom: personne.prenom, nom: personne.nom },
  };
}

/** A wrong code, audited (the count only, never the code typed). */
export async function journaliserCodeErrone(
  tx: Pick<ClientDeBase, "auditLog">,
  auteur: Auteur,
  sessionId: string,
  essais: number,
) {
  await journaliser(tx, auteur, {
    action: "checkout.code_errone",
    entite: "Session",
    entiteId: sessionId,
    apres: { essais },
  });
}

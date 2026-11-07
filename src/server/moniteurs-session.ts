import "server-only";
import { z } from "zod";
import { journaliser } from "@/lib/audit";
import type { ClientDeBase, ContexteEglise } from "@/lib/tenant";
import { verrouillerSession } from "./sessions";

/**
 * Monitors of a session (cahier §7.2, RG-05). A monitor joins a class (badge scan or
 * selection); joining another class ends the previous assignment, so a monitor is in one
 * class at a time (partial unique index). A class opens when it reaches its minimum number of
 * monitors; a RESPONSABLE may force it open with a reason. A class that falls under its
 * minimum afterwards stays open, with a red alert (computed on read, see etatClasses).
 */

type Auteur = Pick<ContexteEglise, "userId" | "appareil">;
type Tx = Pick<ClientDeBase, "auditLog" | "$queryRaw" | "$executeRaw">;

/** A member of the active church, read from the platform table `Membre`. */
export type InfoMembre = { actif: boolean; moniteur: boolean };
export type LectureMembre = (membreId: string) => Promise<InfoMembre | null>;
export type MembreAffectable = { membreId: string; nom: string; moniteur: boolean };

export class AffectationRefusee extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AffectationRefusee";
  }
}

export const schemaForcage = z.object({
  motif: z
    .string()
    .trim()
    .min(3, "Saisissez le motif de l'ouverture forcée.")
    .max(200, "Le motif compte 200 caractères au plus."),
});

async function sessionOuverte(tx: Tx, sessionId: string) {
  const statut = await verrouillerSession(tx, sessionId);
  if (!statut) throw new AffectationRefusee("Session introuvable. Rechargez la page.");
  if (statut !== "OUVERTE") {
    throw new AffectationRefusee("La session n'est pas ouverte : demandez au responsable.");
  }
}

/**
 * The class of the session, created if needed (a class activated after the opening), and
 * locked: the monitors joining one class are serialised, so its opening is never missed.
 */
async function verrouillerClasse(tx: Tx, sessionId: string, classeId: string) {
  await tx.$executeRaw`
    INSERT INTO "SessionClasse" (id, "egliseId", "sessionId", "classeId")
    SELECT gen_random_uuid()::text, k."egliseId", ${sessionId}, k.id
    FROM "Classe" k WHERE k.id = ${classeId} AND k.active
    ON CONFLICT ("sessionId", "classeId") DO NOTHING`;
  const [classe] = await tx.$queryRaw<
    { id: string; ouverteLe: Date | null; minMoniteurs: number; active: boolean }[]
  >`
    SELECT sc.id, sc."ouverteLe", k."minMoniteurs", k.active
    FROM "SessionClasse" sc JOIN "Classe" k ON k.id = sc."classeId"
    WHERE sc."sessionId" = ${sessionId} AND sc."classeId" = ${classeId}
    FOR UPDATE OF sc`;
  if (!classe) throw new AffectationRefusee("Classe introuvable ou inactive. Rechargez la page.");
  return classe;
}

/**
 * A member joins a class of an open session. A member without the MONITEUR role only as a
 * reinforcement (added by a RESPONSABLE: checked by the action). Ends the member's previous
 * assignment, opens the class when it reaches its minimum, with audit entries.
 */
export async function rejoindreClasse(
  tx: Tx,
  auteur: Auteur,
  lireMembre: LectureMembre,
  saisie: { sessionId: string; classeId: string; membreId: string; renfort: boolean },
): Promise<{ affectationId: string; classeOuverte: boolean; precedente: string | null }> {
  const membre = await lireMembre(saisie.membreId);
  if (!membre?.actif) {
    throw new AffectationRefusee("Ce compte n'est pas actif dans cette église.");
  }
  if (!membre.moniteur && !saisie.renfort) {
    throw new AffectationRefusee(
      "Ce compte n'a pas le rôle moniteur : le responsable peut l'ajouter comme renfort.",
    );
  }
  await sessionOuverte(tx, saisie.sessionId);
  const classe = await verrouillerClasse(tx, saisie.sessionId, saisie.classeId);
  if (!classe.active) throw new AffectationRefusee("Cette classe est inactive.");

  const [deja] = await tx.$queryRaw<{ id: string; sessionClasseId: string }[]>`
    SELECT id, "sessionClasseId" FROM "AffectationMoniteur"
    WHERE "membreId" = ${saisie.membreId} AND depart IS NULL`;
  if (deja?.sessionClasseId === classe.id) {
    throw new AffectationRefusee("Ce moniteur est déjà dans cette classe.");
  }
  if (deja) {
    await tx.$executeRaw`UPDATE "AffectationMoniteur" SET depart = now() WHERE id = ${deja.id}`;
    await journaliser(tx, auteur, {
      action: "moniteur.parti",
      entite: "AffectationMoniteur",
      entiteId: deja.id,
      apres: { raison: "autre_classe" },
    });
  }

  const [nouvelle] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "AffectationMoniteur" (id, "egliseId", "sessionClasseId", "membreId", renfort)
    SELECT gen_random_uuid()::text, sc."egliseId", sc.id, ${saisie.membreId}, ${saisie.renfort}
    FROM "SessionClasse" sc WHERE sc.id = ${classe.id}
    RETURNING id`;
  await journaliser(tx, auteur, {
    action: "moniteur.arrive",
    entite: "AffectationMoniteur",
    entiteId: nouvelle!.id,
    apres: {
      sessionClasseId: classe.id,
      membreId: saisie.membreId,
      renfort: saisie.renfort,
      precedente: deja?.id ?? null,
    },
  });

  let classeOuverte = classe.ouverteLe !== null;
  if (!classeOuverte) {
    const [ligne] = await tx.$queryRaw<{ presents: number }[]>`
      SELECT count(*)::int AS presents FROM "AffectationMoniteur"
      WHERE "sessionClasseId" = ${classe.id} AND depart IS NULL`;
    if ((ligne?.presents ?? 0) >= classe.minMoniteurs) {
      await tx.$executeRaw`UPDATE "SessionClasse" SET "ouverteLe" = now() WHERE id = ${classe.id}`;
      await journaliser(tx, auteur, {
        action: "classe.ouverte",
        entite: "SessionClasse",
        entiteId: classe.id,
        apres: { moniteurs: ligne?.presents ?? 0, minimum: classe.minMoniteurs },
      });
      classeOuverte = true;
    }
  }
  return { affectationId: nouvelle!.id, classeOuverte, precedente: deja?.id ?? null };
}

/** The member leaves their class. Returns false when they were in none. */
export async function quitterClasse(tx: Tx, auteur: Auteur, membreId: string): Promise<boolean> {
  const [quittee] = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "AffectationMoniteur" SET depart = now()
    WHERE "membreId" = ${membreId} AND depart IS NULL
    RETURNING id`;
  if (!quittee) return false;
  await journaliser(tx, auteur, {
    action: "moniteur.parti",
    entite: "AffectationMoniteur",
    entiteId: quittee.id,
    apres: { raison: "depart" },
  });
  return true;
}

/** A RESPONSABLE opens a class below its minimum, with a reason (RG-05). */
export async function forcerOuverture(
  tx: Tx,
  auteur: Auteur,
  saisie: { sessionId: string; classeId: string; motif: unknown },
): Promise<void> {
  const { motif } = schemaForcage.parse({ motif: saisie.motif });
  await sessionOuverte(tx, saisie.sessionId);
  const classe = await verrouillerClasse(tx, saisie.sessionId, saisie.classeId);
  if (classe.ouverteLe) throw new AffectationRefusee("Cette classe est déjà ouverte.");
  await tx.$executeRaw`
    UPDATE "SessionClasse"
    SET "ouverteLe" = now(), "forcageMotif" = ${motif}, "forcePar" = ${auteur.userId}
    WHERE id = ${classe.id}`;
  await journaliser(tx, auteur, {
    action: "classe.forcee",
    entite: "SessionClasse",
    entiteId: classe.id,
    apres: { motif, minimum: classe.minMoniteurs },
  });
}

export type EtatClasse = {
  classeId: string;
  nom: string;
  salle: string | null;
  minMoniteurs: number;
  ouverte: boolean;
  forcee: boolean;
  moniteurs: { membreId: string; renfort: boolean }[];
  /** Open, but fewer monitors than its minimum now (cahier §7.2.5): red alert. */
  sousMinimum: boolean;
};

/** Classes of a session in display order, with their monitors present and their state. */
export async function etatClasses(
  db: Pick<ClientDeBase, "classe" | "sessionClasse">,
  sessionId: string,
): Promise<EtatClasse[]> {
  const [classes, ouvertes] = await Promise.all([
    db.classe.findMany({
      where: { OR: [{ active: true }, { sessionClasses: { some: { sessionId } } }] },
      orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      select: { id: true, nom: true, salle: true, minMoniteurs: true },
    }),
    db.sessionClasse.findMany({
      where: { sessionId },
      select: {
        classeId: true,
        ouverteLe: true,
        forcageMotif: true,
        moniteurs: {
          where: { depart: null },
          orderBy: { arrivee: "asc" },
          select: { membreId: true, renfort: true },
        },
      },
    }),
  ]);
  const parClasse = new Map(ouvertes.map((o) => [o.classeId, o]));
  return classes.map((k) => {
    const sc = parClasse.get(k.id);
    const moniteurs = sc?.moniteurs ?? [];
    const ouverte = Boolean(sc?.ouverteLe);
    return {
      classeId: k.id,
      nom: k.nom,
      salle: k.salle,
      minMoniteurs: k.minMoniteurs,
      ouverte,
      forcee: Boolean(sc?.forcageMotif),
      moniteurs,
      sousMinimum: ouverte && moniteurs.length < k.minMoniteurs,
    };
  });
}

/** The class the member is in now, in an open session, if any. */
export async function affectationActive(
  db: Pick<ClientDeBase, "$queryRaw">,
  membreId: string,
): Promise<{ sessionId: string; classeId: string } | null> {
  const [ligne] = await db.$queryRaw<{ sessionId: string; classeId: string }[]>`
    SELECT sc."sessionId", sc."classeId"
    FROM "AffectationMoniteur" a
    JOIN "SessionClasse" sc ON sc.id = a."sessionClasseId"
    JOIN "Session" s ON s.id = sc."sessionId"
    WHERE a."membreId" = ${membreId} AND a.depart IS NULL AND s.statut = 'OUVERTE'`;
  return ligne ?? null;
}

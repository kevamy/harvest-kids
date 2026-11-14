"use server";

import { revalidatePath } from "next/cache";
import { peut } from "@/lib/rbac";
import { MESSAGES_SCAN, resoudreJeton } from "@/server/cartes/resolution";
import {
  AffectationRefusee,
  forcerOuverture,
  quitterClasse,
  rejoindreClasse,
} from "@/server/moniteurs-session";
import { prismaPourMoniteurs } from "@/server/plateforme/badges";
import { lectureMembreEglise, membresAffectablesEglise } from "@/server/plateforme/membres-session";
import { SessionRefusee, cloturerSession, ouvrirSession } from "@/server/sessions";
import {
  RefusMetier,
  executerAction,
  executerActionAvec,
  type ResultatAction,
} from "../executer-action";

/**
 * Sessions and monitors (cahier §7.2, RG-05). Each action checks the session, the church
 * and the role itself, then calls the service, which writes the audit in its transaction.
 */

const texte = (valeur: unknown, message: string) => {
  if (typeof valeur !== "string" || !valeur) throw new RefusMetier(message);
  return valeur;
};

/** The member behind a scanned badge, or the scan message (RG-03, RG-14). */
async function membreDuBadge(
  db: Parameters<typeof resoudreJeton>[0],
  contexte: Parameters<typeof prismaPourMoniteurs>[0],
  jeton: string,
): Promise<string> {
  const badge = await resoudreJeton(db, jeton, prismaPourMoniteurs(contexte));
  if (badge.statut === "active" && badge.type === "badge") return badge.membreId;
  throw new RefusMetier(
    badge.statut === "active" || badge.statut === "en_attente"
      ? "Ce n'est pas un badge moniteur. Scannez le badge du moniteur."
      : MESSAGES_SCAN[badge.statut],
  );
}

/** Business refusals of the services become the message shown. */
async function refus<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (erreur) {
    if (erreur instanceof SessionRefusee || erreur instanceof AffectationRefusee) {
      throw new RefusMetier(erreur.message);
    }
    throw erreur;
  }
}

export async function ouvrirLaSession(sessionId: unknown): Promise<ResultatAction> {
  const resultat = await executerAction("sessions.gerer", async ({ db, contexte }) => {
    const id = texte(sessionId, "Session introuvable. Rechargez la page.");
    const trouvee = await refus(() => db.$tx((tx) => ouvrirSession(tx, contexte, id)));
    if (!trouvee) throw new RefusMetier("Session introuvable. Rechargez la page.");
  });
  if (resultat.ok) revalidatePath("/sessions");
  return resultat;
}

export async function cloturerLaSession(sessionId: unknown): Promise<ResultatAction> {
  const resultat = await executerAction("sessions.gerer", async ({ db, contexte }) => {
    const id = texte(sessionId, "Session introuvable. Rechargez la page.");
    const trouvee = await refus(() => db.$tx((tx) => cloturerSession(tx, contexte, id)));
    if (!trouvee) throw new RefusMetier("Session introuvable. Rechargez la page.");
  });
  if (resultat.ok) revalidatePath("/sessions");
  return resultat;
}

export async function forcerLOuverture(
  sessionId: unknown,
  classeId: unknown,
  motif: unknown,
): Promise<ResultatAction> {
  return executerAction("classe.forcer", async ({ db, contexte }) => {
    const session = texte(sessionId, "Session introuvable. Rechargez la page.");
    const classe = texte(classeId, "Classe introuvable. Rechargez la page.");
    await refus(() =>
      db.$tx((tx) =>
        forcerOuverture(tx, contexte, { sessionId: session, classeId: classe, motif }),
      ),
    );
  });
}

/** Who joins: the monitor whose badge was scanned, a member chosen by the RESPONSABLE, or self. */
export type Arrivee = {
  sessionId: unknown;
  classeId: unknown;
  jeton?: unknown;
  membreId?: unknown;
  renfort?: unknown;
};

export async function rejoindreUneClasse(arrivee: Arrivee): Promise<ResultatAction> {
  return executerAction("classe.voir", async ({ db, contexte }) => {
    const sessionId = texte(arrivee.sessionId, "Session introuvable. Rechargez la page.");
    const classeId = texte(arrivee.classeId, "Classe introuvable. Rechargez la page.");
    const responsable = peut(contexte.roles, "sessions.gerer");
    const renfort = arrivee.renfort === true;
    if (renfort && !responsable) {
      throw new RefusMetier("Seul le responsable ajoute un renfort.");
    }

    let membreId = contexte.membreId;
    if (typeof arrivee.jeton === "string" && arrivee.jeton) {
      // A badge proves who arrives: it is resolved again here, never trusted from the client.
      membreId = await membreDuBadge(db, contexte, arrivee.jeton);
    } else if (typeof arrivee.membreId === "string" && arrivee.membreId !== contexte.membreId) {
      if (!responsable) throw new RefusMetier("Seul le responsable affecte un autre moniteur.");
      membreId = arrivee.membreId;
    }

    await refus(() =>
      db.$tx((tx) =>
        rejoindreClasse(tx, contexte, lectureMembreEglise(contexte), {
          sessionId,
          classeId,
          membreId,
          renfort,
        }),
      ),
    );
  });
}

/** Leaves the class: self, or any member for the RESPONSABLE. */
export async function quitterLaClasse(membreId?: unknown): Promise<ResultatAction> {
  return executerAction("classe.voir", async ({ db, contexte }) => {
    let cible = contexte.membreId;
    if (typeof membreId === "string" && membreId !== contexte.membreId) {
      if (!peut(contexte.roles, "sessions.gerer")) {
        throw new RefusMetier("Seul le responsable fait sortir un autre moniteur.");
      }
      cible = membreId;
    }
    const sorti = await db.$tx((tx) => quitterClasse(tx, contexte, cible));
    if (!sorti) throw new RefusMetier("Ce moniteur n'est dans aucune classe.");
  });
}

/** The monitor behind a scanned badge, to show their name before choosing the class. */
export async function identifierBadge(jeton: unknown) {
  return executerActionAvec("classe.voir", async ({ db, contexte }) => {
    const membreId = await membreDuBadge(
      db,
      contexte,
      texte(jeton, "Scannez le badge du moniteur."),
    );
    const membres = await membresAffectablesEglise(contexte);
    return { nom: membres.find((m) => m.membreId === membreId)?.nom ?? "Moniteur" };
  });
}

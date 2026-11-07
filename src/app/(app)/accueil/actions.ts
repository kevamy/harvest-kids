"use server";

import {
  CheckinRefuse,
  preparerCheckin,
  validerCheckin,
  type PreparationCheckin,
  type ResultatCheckin,
} from "@/server/checkin";
import { rechercherFamilles } from "@/server/familles";
import { prismaPourMoniteurs } from "@/server/plateforme/badges";
import { RefusMetier, executerActionAvec } from "../executer-action";

/**
 * Check-in at the reception desk (cahier §7.3). Each action checks the session, the church
 * and the "checkin" right itself. Preparing only reads; validating writes everything in one
 * transaction (service src/server/checkin.ts, with its audit).
 */

export type ReponsePreparation =
  { preparation: PreparationCheckin } | { refus: string; brouillonId: string | null };

const texte = (valeur: unknown) => (typeof valeur === "string" ? valeur.trim() : "");

/** After a scan (jeton) or a search result (familleId). Read-only. */
export async function preparerLeCheckin(saisie: {
  sessionId: unknown;
  jeton?: unknown;
  familleId?: unknown;
}) {
  return executerActionAvec("checkin", async ({ db, contexte }): Promise<ReponsePreparation> => {
    const sessionId = texte(saisie.sessionId);
    const jeton = texte(saisie.jeton);
    const familleId = texte(saisie.familleId);
    if (!sessionId || (!jeton && !familleId)) {
      throw new RefusMetier("Scannez la carte ou recherchez la famille.");
    }
    try {
      const preparation = await preparerCheckin(
        db,
        prismaPourMoniteurs(contexte),
        jeton ? { sessionId, jeton } : { sessionId, familleId },
      );
      return { preparation };
    } catch (erreur) {
      if (erreur instanceof CheckinRefuse) {
        return { refus: erreur.message, brouillonId: erreur.brouillonId };
      }
      throw erreur;
    }
  });
}

export async function validerLeCheckin(saisie: unknown) {
  return executerActionAvec("checkin", async ({ db, contexte }): Promise<ResultatCheckin> => {
    try {
      return await db.$tx((tx) =>
        validerCheckin(tx, contexte, prismaPourMoniteurs(contexte), saisie),
      );
    } catch (erreur) {
      if (erreur instanceof CheckinRefuse) throw new RefusMetier(erreur.message);
      throw erreur;
    }
  });
}

/** Family search when the card is missing (cahier §7.3.1). */
export async function rechercherPourCheckin(terme: unknown) {
  return executerActionAvec("checkin", async ({ db }) =>
    (await rechercherFamilles(db, texte(terme).slice(0, 80))).map((f) => ({
      id: f.id,
      nom: f.nom,
      prenoms: f.enfants.map((e) => e.prenom),
      brouillon: f.finaliseeLe === null,
    })),
  );
}

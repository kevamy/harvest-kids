"use server";

import {
  CheckinRefuse,
  preparerCheckin,
  validerCheckin,
  type PreparationCheckin,
  type ResultatCheckin,
} from "@/server/checkin";
import { getSessionCourante } from "@/lib/session";
import type { ClientEglise, ContexteEglise } from "@/lib/tenant";
import {
  CheckoutRefuse,
  journaliserCodeErrone,
  preparerCheckout,
  validerCheckout,
  type PreparationCheckout,
  type ResultatCheckout,
} from "@/server/checkout";
import { rechercherFamilles } from "@/server/familles";
import { prismaPourMoniteurs } from "@/server/plateforme/badges";
import {
  REGLE_CODE_RETRAIT,
  codeRetraitBloque,
  compterCodeErrone,
} from "@/server/plateforme/limitation";
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

export type ReponsePreparationCheckout = { preparation: PreparationCheckout } | { refus: string };

/** The tablet, for the wrong-code limit: the signed-in session (ADR 0016). */
async function tablette(): Promise<string> {
  return (await getSessionCourante())?.sessionId ?? "inconnue";
}

const messageBlocage = (ms: number) =>
  `Trop de codes erronés sur cette tablette : la saisie d'un code reprend dans ${Math.max(1, Math.ceil(ms / 60_000))} min. Scannez la carte du parent, ou appelez le responsable.`;

/** Counts a wrong code against the tablet, audits it, and says what to do. */
async function refuserCode(
  { db, contexte }: { db: ClientEglise; contexte: ContexteEglise },
  sessionId: string,
  message: string,
): Promise<string> {
  const etat = await compterCodeErrone(contexte.egliseId, sessionId, await tablette());
  await db.$tx((tx) => journaliserCodeErrone(tx, contexte, sessionId, etat.essais));
  if (etat.bloque) return messageBlocage(etat.reessayerDansMs);
  const restants = REGLE_CODE_RETRAIT.max - etat.essais;
  return `${message} Encore ${restants} essai${restants > 1 ? "s" : ""} avant le blocage de la tablette.`;
}

/** Check-out (cahier §7.6), after a scan (jeton) or a retrieval code. Read-only. */
export async function preparerLeCheckout(saisie: {
  sessionId: unknown;
  jeton?: unknown;
  code?: unknown;
}) {
  return executerActionAvec("checkout", async (acces): Promise<ReponsePreparationCheckout> => {
    const { db, contexte } = acces;
    const sessionId = texte(saisie.sessionId);
    const jeton = texte(saisie.jeton);
    const code = texte(saisie.code);
    if (!sessionId || (!jeton && !code)) {
      throw new RefusMetier("Scannez la carte ou saisissez le code de retrait.");
    }
    if (!jeton) {
      const etat = await codeRetraitBloque(contexte.egliseId, sessionId, await tablette());
      if (etat.bloque) return { refus: messageBlocage(etat.reessayerDansMs) };
    }
    try {
      const preparation = await preparerCheckout(
        db,
        prismaPourMoniteurs(contexte),
        jeton ? { sessionId, jeton } : { sessionId, code },
      );
      return { preparation };
    } catch (erreur) {
      if (erreur instanceof CheckoutRefuse) {
        return {
          refus: erreur.codeErrone
            ? await refuserCode(acces, sessionId, erreur.message)
            : erreur.message,
        };
      }
      throw erreur;
    }
  });
}

export async function validerLeCheckout(saisie: {
  sessionId?: unknown;
  familleId?: unknown;
  jeton?: unknown;
  code?: unknown;
  personneAutoriseeId?: unknown;
  presenceIds?: unknown;
}) {
  return executerActionAvec("checkout", async (acces): Promise<ResultatCheckout> => {
    const { db, contexte } = acces;
    const sessionId = texte(saisie.sessionId);
    if (texte(saisie.code)) {
      const etat = await codeRetraitBloque(contexte.egliseId, sessionId, await tablette());
      if (etat.bloque) throw new RefusMetier(messageBlocage(etat.reessayerDansMs));
    }
    try {
      return await db.$tx((tx) =>
        validerCheckout(tx, contexte, prismaPourMoniteurs(contexte), saisie),
      );
    } catch (erreur) {
      if (erreur instanceof CheckoutRefuse) {
        throw new RefusMetier(
          erreur.codeErrone ? await refuserCode(acces, sessionId, erreur.message) : erreur.message,
        );
      }
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

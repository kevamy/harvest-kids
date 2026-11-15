"use server";

import {
  CheckinRefuse,
  preparerCheckin,
  validerCheckin,
  type PreparationCheckin,
  type ResultatCheckin,
} from "@/server/checkin";
import { randomUUID } from "node:crypto";
import { cleFichier } from "@/lib/fichiers";
import { getSessionCourante } from "@/lib/session";
import { stockage } from "@/lib/storage";
import { normaliserTelephone } from "@/lib/telephone";
import type { ClientEglise, ContexteEglise } from "@/lib/tenant";
import {
  CheckoutRefuse,
  journaliserCodeErrone,
  preparerCheckout,
  rechercherPourCheckout,
  retraitExceptionnel,
  validerCheckout,
  type PreparationCheckout,
  type ResultatCheckout,
} from "@/server/checkout";
import {
  ROLES_AUTORISATION_RETRAIT,
  ROLES_SECOND_MEMBRE,
  confirmerAvecPinEglise,
  membresConfirmateursEglise,
  type ResultatConfirmationPin,
} from "@/server/plateforme/pin";
import { FamilleRefusee, convertirPhoto, rechercherFamilles } from "@/server/familles";
import { lireParametres } from "@/server/parametres";
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

/** What to say after a second person's PIN (cahier §7.6), unless it was confirmed. */
function messageConfirmation(
  resultat: Exclude<ResultatConfirmationPin, { statut: "confirme" }>,
): string {
  switch (resultat.statut) {
    case "meme_compte":
      return "La confirmation vient d'une autre personne que vous : choisissez un collègue présent.";
    case "non_autorise":
      return "Ce membre ne peut pas confirmer ce retrait : choisissez une autre personne de la liste.";
    case "non_defini":
      return "Ce membre n'a pas encore de code PIN : choisissez une autre personne.";
    case "bloque":
      return "Le PIN de ce membre est bloqué après 5 erreurs : il doit se reconnecter avec son mot de passe.";
    case "incorrect":
      return `PIN incorrect. Encore ${resultat.essaisRestants} essai${resultat.essaisRestants > 1 ? "s" : ""}.`;
  }
}

/** Family search when the parent has neither card nor code (cahier §7.6). */
export async function rechercherPourLeCheckout(sessionId: unknown, terme: unknown) {
  return executerActionAvec("checkout", ({ db }) =>
    rechercherPourCheckout(db, texte(sessionId), texte(terme).slice(0, 80)),
  );
}

/** The colleagues who may confirm a retrieval without card or code on this tablet. */
export async function membresPourConfirmer() {
  return executerActionAvec("checkout", ({ contexte }) =>
    membresConfirmateursEglise({
      egliseId: contexte.egliseId,
      agentUserId: contexte.userId,
      roles: ROLES_SECOND_MEMBRE,
    }),
  );
}

/** The RESPONSABLE and ADMIN who may authorise an exceptional retrieval on this tablet. */
export async function membresPourAutoriser() {
  return executerActionAvec("checkout", ({ contexte }) =>
    membresConfirmateursEglise({
      egliseId: contexte.egliseId,
      agentUserId: contexte.userId,
      roles: ROLES_AUTORISATION_RETRAIT,
    }),
  );
}

/**
 * Exceptional retrieval (cahier §7.6): the RESPONSABLE's PIN is checked first, then the photo
 * taken by the tablet is stored under eglises/{church}/retraits/, then everything is written
 * in one transaction (incident, retrieval, children). A failed transaction removes the photo.
 */
export async function autoriserRetraitExceptionnel(formulaire: FormData) {
  return executerActionAvec("checkout", async ({ db, contexte }) => {
    const champ = (nom: string) => texte(formulaire.get(nom));
    const resultat = await confirmerAvecPinEglise(
      {
        egliseId: contexte.egliseId,
        membreId: champ("responsableId"),
        agentUserId: contexte.userId,
        roles: ROLES_AUTORISATION_RETRAIT,
      },
      champ("pin"),
    );
    if (resultat.statut !== "confirme") throw new RefusMetier(messageConfirmation(resultat));

    let telephone = "";
    if (champ("telephone")) {
      const indicatif = (await lireParametres(db))["telephone.indicatifParDefaut"];
      const lu = normaliserTelephone(champ("telephone"), indicatif);
      if (lu.statut !== "valide") {
        throw new RefusMetier(
          lu.statut === "a_confirmer"
            ? "Saisissez le numéro en entier, avec ses 10 chiffres."
            : lu.message,
        );
      }
      telephone = lu.e164;
    }

    const fichier = formulaire.get("photo");
    if (!(fichier instanceof File) || fichier.size === 0) {
      throw new RefusMetier("Prenez la photo de l'adulte avec la tablette, puis recommencez.");
    }
    let webp: Buffer;
    try {
      webp = await convertirPhoto({
        type: fichier.type,
        octets: new Uint8Array(await fichier.arrayBuffer()),
      });
    } catch (erreur) {
      if (erreur instanceof FamilleRefusee) throw new RefusMetier(erreur.message);
      throw erreur;
    }
    const cle = cleFichier(contexte.egliseId, "retraits", `${randomUUID()}.webp`);
    await stockage().put(cle, webp, "image/webp");

    try {
      return await db.$tx((tx) =>
        retraitExceptionnel(
          tx,
          contexte,
          {
            sessionId: champ("sessionId"),
            familleId: champ("familleId"),
            presenceIds: formulaire.getAll("presenceIds").map(texte),
            nom: champ("nom"),
            lien: champ("lien"),
            telephone,
            motif: champ("motif"),
          },
          { autoriseParUserId: resultat.userId, photoKey: cle },
        ),
      );
    } catch (erreur) {
      // Nothing was recorded: the photo must not stay behind.
      await stockage()
        .delete(cle)
        .catch(() => undefined);
      if (erreur instanceof CheckoutRefuse) throw new RefusMetier(erreur.message);
      throw erreur;
    }
  });
}

/** Check-out (cahier §7.6), after a scan (jeton), a retrieval code or a search. Read-only. */
export async function preparerLeCheckout(saisie: {
  sessionId: unknown;
  jeton?: unknown;
  code?: unknown;
  familleId?: unknown;
}) {
  return executerActionAvec("checkout", async (acces): Promise<ReponsePreparationCheckout> => {
    const { db, contexte } = acces;
    const sessionId = texte(saisie.sessionId);
    const jeton = texte(saisie.jeton);
    const code = texte(saisie.code);
    const familleId = texte(saisie.familleId);
    if (!sessionId || (!jeton && !code && !familleId)) {
      throw new RefusMetier("Scannez la carte ou saisissez le code de retrait.");
    }
    if (familleId) {
      try {
        return {
          preparation: await preparerCheckout(db, prismaPourMoniteurs(contexte), {
            sessionId,
            familleId,
          }),
        };
      } catch (erreur) {
        if (erreur instanceof CheckoutRefuse) return { refus: erreur.message };
        throw erreur;
      }
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
  /** Without card or code: the colleague who confirms, and their PIN. */
  secondMembreId?: unknown;
  pin?: unknown;
}) {
  return executerActionAvec("checkout", async (acces): Promise<ResultatCheckout> => {
    const { db, contexte } = acces;
    const sessionId = texte(saisie.sessionId);
    const { secondMembreId, pin, ...donnees } = saisie;
    if (texte(saisie.code)) {
      const etat = await codeRetraitBloque(contexte.egliseId, sessionId, await tablette());
      if (etat.bloque) throw new RefusMetier(messageBlocage(etat.reessayerDansMs));
    }
    // Neither card nor code: a colleague confirms with their PIN, checked here (cahier §7.6).
    let confirmation: { secondMembreUserId: string } | undefined;
    if (!texte(saisie.code) && !texte(saisie.jeton)) {
      if (!texte(secondMembreId) || !texte(pin)) {
        throw new RefusMetier(
          "Sans carte ni code, un second membre de l'équipe confirme le retrait avec son PIN.",
        );
      }
      const resultat = await confirmerAvecPinEglise(
        {
          egliseId: contexte.egliseId,
          membreId: texte(secondMembreId),
          agentUserId: contexte.userId,
          roles: ROLES_SECOND_MEMBRE,
        },
        texte(pin),
      );
      if (resultat.statut !== "confirme") throw new RefusMetier(messageConfirmation(resultat));
      confirmation = { secondMembreUserId: resultat.userId };
    }
    try {
      return await db.$tx((tx) =>
        validerCheckout(tx, contexte, prismaPourMoniteurs(contexte), donnees, confirmation),
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

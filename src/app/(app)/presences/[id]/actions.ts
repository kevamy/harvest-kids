"use server";

import { ActionInterdite } from "@/lib/rbac";
import type { ClientDeBase, ClientEglise } from "@/lib/tenant";
import { AppelRefuse, appelerParent, resoudreAppel } from "@/server/appels";
import { lireParametres } from "@/server/parametres";
import {
  InfirmerieRefusee,
  envoyerInfirmerie,
  recevoirInfirmerie,
  renvoyerEnClasse,
} from "@/server/infirmerie";
import { membresActifsEglise } from "@/server/plateforme/membres-session";
import { UrgenceRefusee, journaliserAppel, noterResultatAppel } from "@/server/urgence";
import { RefusMetier, executerActionVerifiee } from "../../executer-action";
import { presenceAutorisee } from "../acces-presence";

/**
 * Urgence button (cahier §7.9, ADR 0019). Each action reads the presence in the active church
 * and checks the member's rights on it (droitsPresence, lib/rbac.ts) before the service,
 * which writes the call log and the audit in one transaction.
 */

const texte = (valeur: unknown) => (typeof valeur === "string" ? valeur.trim() : "");

async function enTransaction<T>(db: ClientEglise, fn: (tx: ClientDeBase) => Promise<T>) {
  try {
    return await db.$tx(fn);
  } catch (erreur) {
    if (
      erreur instanceof UrgenceRefusee ||
      erreur instanceof InfirmerieRefusee ||
      erreur instanceof AppelRefuse
    ) {
      throw new RefusMetier(erreur.message);
    }
    throw erreur;
  }
}

/** Calls the parent to the screen (cahier §7.5), to one of the church's meeting places. */
export async function appelerLeParent(saisie: {
  presenceId: unknown;
  motif: unknown;
  lieu: unknown;
}) {
  const presenceId = texte(saisie.presenceId);
  return executerActionVerifiee(
    (acces) => verifierAppel(acces, presenceId),
    async ({ db, contexte }) => {
      const lieux = (await lireParametres(db))["appels.lieux"];
      return enTransaction(db, (tx) =>
        appelerParent(tx, contexte, { presenceId, motif: saisie.motif, lieu: saisie.lieu }, lieux),
      );
    },
  );
}

/** The parent arrived, or the call is cancelled. */
export async function terminerAppel(saisie: { presenceId: unknown; resolution: unknown }) {
  const presenceId = texte(saisie.presenceId);
  return executerActionVerifiee(
    (acces) => verifierAppel(acces, presenceId),
    ({ db, contexte }) =>
      enTransaction(db, (tx) =>
        resoudreAppel(tx, contexte, { presenceId, resolution: saisie.resolution }),
      ),
  );
}

/** The presence, and a right of droitsPresence the member must have on it. */
async function verifierDroit(
  acces: Parameters<typeof presenceAutorisee>[0],
  presenceId: string,
  droit: "envoyer" | "gerer",
) {
  const autorisee = await presenceAutorisee(acces, presenceId);
  if (!autorisee) throw new RefusMetier("Enfant introuvable. Rechargez la page.");
  if (!autorisee.droits[droit]) {
    throw new ActionInterdite(droit === "envoyer" ? "infirmerie.envoyer" : "infirmerie.gerer");
  }
}

/** Accompany to the infirmerie (cahier §7.7): PRESENT or in class → INFIRMERIE, en route. */
export async function envoyerAInfirmerie(saisie: {
  presenceId: unknown;
  accompagnantUserId: unknown;
  motif: unknown;
}) {
  const presenceId = texte(saisie.presenceId);
  return executerActionVerifiee(
    (acces) => verifierDroit(acces, presenceId, "envoyer"),
    async ({ db, contexte }) => {
      const membres = await membresActifsEglise(contexte);
      return enTransaction(db, (tx) =>
        envoyerInfirmerie(
          tx,
          contexte,
          { presenceId, accompagnantUserId: saisie.accompagnantUserId, motif: saisie.motif },
          async (userId) => membres.some((m) => m.userId === userId),
        ),
      );
    },
  );
}

/** The infirmerie receives the child (no longer "en route"). */
export async function recevoirAInfirmerie(saisie: { presenceId: unknown }) {
  const presenceId = texte(saisie.presenceId);
  return executerActionVerifiee(
    (acces) => verifierDroit(acces, presenceId, "gerer"),
    ({ db, contexte }) =>
      enTransaction(db, (tx) => recevoirInfirmerie(tx, contexte, { presenceId })),
  );
}

/** Back to class: PRESENT, to be confirmed by a member of the class. */
export async function renvoyerEnClasseDepuisInfirmerie(saisie: { presenceId: unknown }) {
  const presenceId = texte(saisie.presenceId);
  return executerActionVerifiee(
    (acces) => verifierDroit(acces, presenceId, "gerer"),
    ({ db, contexte }) => enTransaction(db, (tx) => renvoyerEnClasse(tx, contexte, { presenceId })),
  );
}

/** Rights to call the family of this presence; a child out of reach is refused alike. */
async function verifierAppel(acces: Parameters<typeof presenceAutorisee>[0], presenceId: string) {
  const autorisee = await presenceAutorisee(acces, presenceId);
  if (!autorisee) throw new RefusMetier("Enfant introuvable. Rechargez la page.");
  if (!autorisee.droits.appeler) throw new ActionInterdite("parent.appeler");
}

export async function journaliserAppelUrgence(saisie: {
  presenceId: unknown;
  numero: unknown;
  canal: unknown;
}) {
  const presenceId = texte(saisie.presenceId);
  return executerActionVerifiee(
    (acces) => verifierAppel(acces, presenceId),
    ({ db, contexte }) =>
      enTransaction(db, (tx) =>
        journaliserAppel(tx, contexte, {
          presenceId,
          numero: saisie.numero,
          canal: saisie.canal,
        }),
      ),
  );
}

export async function noterResultatUrgence(saisie: {
  presenceId: unknown;
  appelId: unknown;
  resultat: unknown;
}) {
  const presenceId = texte(saisie.presenceId);
  return executerActionVerifiee(
    (acces) => verifierAppel(acces, presenceId),
    async ({ db, contexte }) => {
      await enTransaction(db, (tx) =>
        noterResultatAppel(tx, contexte, presenceId, {
          appelId: saisie.appelId,
          resultat: saisie.resultat,
        }),
      );
      return null;
    },
  );
}

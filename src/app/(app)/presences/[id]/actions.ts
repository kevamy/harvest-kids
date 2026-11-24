"use server";

import { ActionInterdite } from "@/lib/rbac";
import type { ClientDeBase, ClientEglise } from "@/lib/tenant";
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
    if (erreur instanceof UrgenceRefusee) throw new RefusMetier(erreur.message);
    throw erreur;
  }
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

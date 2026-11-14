"use server";

import { ActionInterdite, droitsSalle } from "@/lib/rbac";
import type { ClientDeBase, ClientEglise, ContexteEglise } from "@/lib/tenant";
import { prismaPourMoniteurs } from "@/server/plateforme/badges";
import {
  SalleRefusee,
  annulerEnSalle,
  classeDeSession,
  confirmerParScan,
  confirmerParToucher,
  estAffecte,
  type ClasseDeSession,
  type ResultatConfirmation,
} from "@/server/salle";
import { RefusMetier, executerActionVerifiee } from "../../executer-action";

/**
 * Arrival in class (cahier §7.4, ADR 0015). The right comes from the assignment: each action
 * reads the class in the active church and the member's assignment, then checks it with
 * droitsSalle (lib/rbac.ts) before calling the service, which writes the event and the audit.
 */

const texte = (valeur: unknown) => (typeof valeur === "string" ? valeur.trim() : "");

type Acces = { db: ClientEglise; contexte: ContexteEglise };

/** The class of the session and the member's rights on it; refuses what they may not do. */
async function classeAutorisee(
  { db, contexte }: Acces,
  sessionClasseId: unknown,
  besoin: "confirmer" | "annuler",
) {
  const classe = await classeDeSession(db, texte(sessionClasseId));
  if (!classe) throw new RefusMetier("Classe introuvable dans cette session. Rechargez la page.");
  const droits = droitsSalle(
    contexte.roles,
    await estAffecte(db, classe.sessionClasseId, contexte.membreId),
  );
  const permis = besoin === "confirmer" ? droits.confirmer : droits.voir;
  if (!permis) throw new ActionInterdite("salle.superviser");
  return { classe, droits };
}

/** Business refusals of the service become the message shown on the tablet. */
async function enTransaction<T>(db: ClientEglise, fn: (tx: ClientDeBase) => Promise<T>) {
  try {
    return await db.$tx(fn);
  } catch (erreur) {
    if (erreur instanceof SalleRefusee) throw new RefusMetier(erreur.message);
    throw erreur;
  }
}

export async function confirmerArrivee(saisie: { sessionClasseId: unknown; presenceId: unknown }) {
  let classe: ClasseDeSession;
  return executerActionVerifiee(
    async (acces) => {
      ({ classe } = await classeAutorisee(acces, saisie.sessionClasseId, "confirmer"));
    },
    ({ db, contexte }) =>
      enTransaction<ResultatConfirmation>(db, (tx) =>
        confirmerParToucher(tx, contexte, classe, { presenceId: saisie.presenceId }),
      ),
  );
}

export async function confirmerArriveeParScan(saisie: {
  sessionClasseId: unknown;
  jeton: unknown;
}) {
  let classe: ClasseDeSession;
  return executerActionVerifiee(
    async (acces) => {
      ({ classe } = await classeAutorisee(acces, saisie.sessionClasseId, "confirmer"));
    },
    ({ db, contexte }) => {
      const jeton = texte(saisie.jeton);
      if (!jeton) throw new RefusMetier("Scannez la carte de l'enfant ou de la famille.");
      return enTransaction<ResultatConfirmation>(db, (tx) =>
        confirmerParScan(tx, contexte, prismaPourMoniteurs(contexte), classe, jeton),
      );
    },
  );
}

export async function annulerArrivee(saisie: {
  sessionClasseId: unknown;
  presenceId: unknown;
  motif?: unknown;
}) {
  let classe: ClasseDeSession;
  let corriger = false;
  return executerActionVerifiee(
    async (acces) => {
      const autorise = await classeAutorisee(acces, saisie.sessionClasseId, "annuler");
      classe = autorise.classe;
      corriger = autorise.droits.corriger;
    },
    ({ db, contexte }) =>
      enTransaction<{ prenom: string }>(db, (tx) =>
        annulerEnSalle(tx, contexte, classe, corriger, {
          presenceId: saisie.presenceId,
          motif: typeof saisie.motif === "string" ? saisie.motif : undefined,
        }),
      ),
  );
}

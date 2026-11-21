"use server";

import { ActionInterdite, droitsSalle } from "@/lib/rbac";
import type { ClientDeBase, ClientEglise, ContexteEglise } from "@/lib/tenant";
import {
  CheckoutRefuse,
  preparerCheckout,
  validerCheckout,
  type PreparationCheckout,
  type ResultatCheckout,
} from "@/server/checkout";
import { lireParametres } from "@/server/parametres";
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
import { blocageCode, refuserCode } from "../../codes-retrait";
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

/**
 * Check-out in class (cahier §7.6), when the church's setting allows it: the members assigned
 * to the class, as for arrivals; only the children of this class are handed over; a card or a
 * code, never a search (the exceptional cases go to the reception desk). Same wrong-code
 * limit as at the reception desk (ADR 0016).
 */
async function classePourRetrait(acces: Acces, sessionClasseId: unknown) {
  const { classe } = await classeAutorisee(acces, sessionClasseId, "confirmer");
  const lieu = (await lireParametres(acces.db))["checkout.lieu"];
  if (lieu !== "ACCUEIL_ET_CLASSES") {
    throw new RefusMetier("Dans cette église, le retrait se fait à l'accueil.");
  }
  return classe;
}

export async function preparerRetraitEnSalle(saisie: {
  sessionClasseId: unknown;
  jeton?: unknown;
  code?: unknown;
}) {
  let classe: ClasseDeSession;
  return executerActionVerifiee(
    async (acces) => {
      classe = await classePourRetrait(acces, saisie.sessionClasseId);
    },
    async (acces): Promise<{ preparation: PreparationCheckout } | { refus: string }> => {
      const jeton = texte(saisie.jeton);
      const code = texte(saisie.code);
      if (!jeton && !code) {
        throw new RefusMetier("Scannez la carte ou saisissez le code de retrait.");
      }
      if (!jeton) {
        const blocage = await blocageCode(acces.contexte.egliseId, classe.sessionId);
        if (blocage) return { refus: blocage };
      }
      try {
        const preparation = await preparerCheckout(
          acces.db,
          prismaPourMoniteurs(acces.contexte),
          jeton ? { sessionId: classe.sessionId, jeton } : { sessionId: classe.sessionId, code },
          { classeId: classe.classeId },
        );
        return { preparation };
      } catch (erreur) {
        if (erreur instanceof CheckoutRefuse) {
          return {
            refus: erreur.codeErrone
              ? await refuserCode(acces, classe.sessionId, erreur.message)
              : erreur.message,
          };
        }
        throw erreur;
      }
    },
  );
}

export async function validerRetraitEnSalle(saisie: {
  sessionClasseId: unknown;
  familleId?: unknown;
  jeton?: unknown;
  code?: unknown;
  personneAutoriseeId?: unknown;
  presenceIds?: unknown;
}) {
  let classe: ClasseDeSession;
  return executerActionVerifiee(
    async (acces) => {
      classe = await classePourRetrait(acces, saisie.sessionClasseId);
    },
    async (acces): Promise<ResultatCheckout> => {
      // The session comes from the class, never from the input.
      const donnees = {
        familleId: saisie.familleId,
        jeton: saisie.jeton,
        code: saisie.code,
        personneAutoriseeId: saisie.personneAutoriseeId,
        presenceIds: saisie.presenceIds,
      };
      if (!texte(saisie.jeton) && !texte(saisie.code)) {
        throw new RefusMetier(
          "Sans carte ni code, le retrait se fait à l'accueil : accompagnez le parent.",
        );
      }
      if (texte(saisie.code)) {
        const blocage = await blocageCode(acces.contexte.egliseId, classe.sessionId);
        if (blocage) throw new RefusMetier(blocage);
      }
      try {
        return await acces.db.$tx((tx) =>
          validerCheckout(
            tx,
            acces.contexte,
            prismaPourMoniteurs(acces.contexte),
            { ...donnees, sessionId: classe.sessionId },
            undefined,
            { classeId: classe.classeId },
          ),
        );
      } catch (erreur) {
        if (erreur instanceof CheckoutRefuse) {
          throw new RefusMetier(
            erreur.codeErrone
              ? await refuserCode(acces, classe.sessionId, erreur.message)
              : erreur.message,
          );
        }
        throw erreur;
      }
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

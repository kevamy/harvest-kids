import "server-only";
import { ZodError } from "zod";
import { ActionInterdite, exigerDroit, type Action } from "@/lib/rbac";
import { AccesRefuse, getTenantDb, type ClientEglise, type ContexteEglise } from "@/lib/tenant";

/** Answer of a church Server Action: never a success unless the server saved it. */
export type ResultatAction = { ok: true } | { ok: false; erreur: string };

const MESSAGES = {
  acces: "Votre session est verrouillée ou a expiré. Reconnectez-vous, puis recommencez.",
  droit: "Vous n'avez pas le droit de faire cette action. Demandez à un administrateur.",
  saisie: "Le formulaire est incomplet. Vérifiez les champs, puis recommencez.",
};

/** Raised by a service for an expected refusal, with the message to show. */
export class RefusMetier extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefusMetier";
  }
}

/**
 * Common frame of a church Server Action: active church from the session, role check
 * (lib/rbac.ts), then the service. Zod and business refusals become a message saying
 * what to do; anything else is a real error and propagates.
 */
export async function executerAction(
  action: Action,
  fn: (acces: { db: ClientEglise; contexte: ContexteEglise }) => Promise<void>,
): Promise<ResultatAction> {
  try {
    const acces = await getTenantDb();
    exigerDroit(acces.contexte, action);
    await fn(acces);
    return { ok: true };
  } catch (erreur) {
    if (erreur instanceof AccesRefuse) return { ok: false, erreur: MESSAGES.acces };
    if (erreur instanceof ActionInterdite) return { ok: false, erreur: MESSAGES.droit };
    if (erreur instanceof ZodError) {
      return { ok: false, erreur: erreur.issues[0]?.message ?? MESSAGES.saisie };
    }
    if (erreur instanceof RefusMetier) return { ok: false, erreur: erreur.message };
    throw erreur;
  }
}

import "server-only";
import { getSessionCourante } from "@/lib/session";
import type { ClientEglise, ContexteEglise } from "@/lib/tenant";
import { journaliserCodeErrone } from "@/server/checkout";
import {
  REGLE_CODE_RETRAIT,
  codeRetraitBloque,
  compterCodeErrone,
} from "@/server/plateforme/limitation";

/**
 * Wrong retrieval codes at check-out (ADR 0016), shared by the reception desk and the
 * check-out in class: 5 per tablet and per session in 15 minutes.
 */

/** The tablet, for the wrong-code limit: the signed-in session. */
export async function tablette(): Promise<string> {
  return (await getSessionCourante())?.sessionId ?? "inconnue";
}

export const messageBlocage = (ms: number) =>
  `Trop de codes erronés sur cette tablette : la saisie d'un code reprend dans ${Math.max(1, Math.ceil(ms / 60_000))} min. Scannez la carte du parent, ou appelez le responsable.`;

/** The blocking message when the tablet is blocked for this session, or null. */
export async function blocageCode(egliseId: string, sessionId: string): Promise<string | null> {
  const etat = await codeRetraitBloque(egliseId, sessionId, await tablette());
  return etat.bloque ? messageBlocage(etat.reessayerDansMs) : null;
}

/** Counts a wrong code against the tablet, audits it, and says what to do. */
export async function refuserCode(
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

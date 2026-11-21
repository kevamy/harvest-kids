import "server-only";
import { getSessionCourante } from "@/lib/session";
import type { ClientEglise, ContexteEglise } from "@/lib/tenant";
import { journaliserCodeErrone } from "@/server/checkout";
import {
  codeRetraitBloque,
  compterCodeErrone,
  type EtatCodeRetrait,
} from "@/server/plateforme/limitation";

/**
 * Wrong retrieval codes at check-out (ADR 0016), shared by the reception desk and the
 * check-out in class: 5 per tablet and per session in 15 minutes, and 20 per session of
 * worship, every tablet and every sign-in together.
 */

/** The tablet, for the wrong-code limit: the signed-in session. */
export async function tablette(): Promise<string> {
  return (await getSessionCourante())?.sessionId ?? "inconnue";
}

export const messageBlocage = (ms: number) =>
  `Trop de codes erronés sur cette tablette : la saisie d'un code reprend dans ${Math.max(1, Math.ceil(ms / 60_000))} min. Scannez la carte du parent, ou appelez le responsable.`;

export const MESSAGE_BLOCAGE_SESSION =
  "Trop de codes erronés pendant cette session, toutes tablettes confondues : la saisie des codes est bloquée jusqu'à la fin de la session. Scannez la carte du parent, ou appelez le responsable.";

function messageEtat(etat: EtatCodeRetrait): string | null {
  if (etat.bloque === "session") return MESSAGE_BLOCAGE_SESSION;
  if (etat.bloque === "tablette") return messageBlocage(etat.reessayerDansMs);
  return null;
}

/** The blocking message when code entry is blocked for this tablet and session, or null. */
export async function blocageCode(egliseId: string, sessionId: string): Promise<string | null> {
  return messageEtat(await codeRetraitBloque(egliseId, sessionId, await tablette()));
}

/** Counts a wrong code against the tablet and the session, audits it, and says what to do. */
export async function refuserCode(
  { db, contexte }: { db: ClientEglise; contexte: ContexteEglise },
  sessionId: string,
  message: string,
): Promise<string> {
  const etat = await compterCodeErrone(contexte.egliseId, sessionId, await tablette());
  await db.$tx((tx) => journaliserCodeErrone(tx, contexte, sessionId, etat));
  const blocage = messageEtat(etat);
  if (blocage) return blocage;
  const s = etat.restants > 1 ? "s" : "";
  return etat.prochainBlocage === "session"
    ? `${message} Encore ${etat.restants} essai${s} avant le blocage des codes sur toutes les tablettes.`
    : `${message} Encore ${etat.restants} essai${s} avant le blocage de la tablette.`;
}

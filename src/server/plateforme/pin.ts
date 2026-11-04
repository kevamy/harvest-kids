import "server-only";
import { verifyPassword } from "better-auth/crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { MAX_ECHECS_PIN, apresEchecPin, pinBloque } from "@/lib/pin";
import { hacherPin } from "./comptes";

export type ResultatPin =
  | { statut: "deverrouille" }
  | { statut: "incorrect"; essaisRestants: number }
  | { statut: "bloque" }
  | { statut: "non_defini" };

/** Defines (or replaces) the PIN of a membership and clears previous failures. */
export async function definirPin(base: PrismaClient, membreId: string, pin: string) {
  await base.membre.update({
    where: { id: membreId },
    data: { pinHash: await hacherPin(pin), pinEchecs: 0, pinBloqueJusqua: null },
  });
}

/**
 * Unlocks a locked session with the PIN of the person's membership in the active
 * church. Success records activity now; failures are counted and block the PIN.
 */
export async function deverrouillerAvecPin(
  base: PrismaClient,
  cible: { sessionId: string; userId: string; egliseId: string },
  pin: string,
  maintenant: Date,
): Promise<ResultatPin> {
  const membre = await base.membre.findUnique({
    where: { egliseId_userId: { egliseId: cible.egliseId, userId: cible.userId } },
    select: { id: true, pinHash: true, pinEchecs: true, pinBloqueJusqua: true, actif: true },
  });
  if (!membre?.actif || !membre.pinHash) return { statut: "non_defini" };
  if (pinBloque(membre, maintenant)) return { statut: "bloque" };

  if (await verifyPassword({ hash: membre.pinHash, password: pin })) {
    await base.$transaction([
      base.membre.update({
        where: { id: membre.id },
        data: { pinEchecs: 0, pinBloqueJusqua: null },
      }),
      base.authSession.updateMany({
        where: { id: cible.sessionId, userId: cible.userId },
        data: { derniereActivite: maintenant },
      }),
    ]);
    return { statut: "deverrouille" };
  }

  // Atomic increment, then block once the threshold is reached.
  const { pinEchecs } = await base.membre.update({
    where: { id: membre.id },
    data: { pinEchecs: { increment: 1 } },
    select: { pinEchecs: true },
  });
  const suivant = apresEchecPin({ pinEchecs: pinEchecs - 1, pinBloqueJusqua: null }, maintenant);
  if (suivant.pinBloqueJusqua) {
    await base.membre.update({
      where: { id: membre.id },
      data: { pinBloqueJusqua: suivant.pinBloqueJusqua },
    });
    return { statut: "bloque" };
  }
  return { statut: "incorrect", essaisRestants: MAX_ECHECS_PIN - pinEchecs };
}

/**
 * A successful password sign-in clears PIN failures for all the person's memberships.
 * Only the memberships that have failures or a block are written: an ordinary sign-in
 * changes nothing (not even `updatedAt`).
 */
export async function reinitialiserEchecsPin(base: PrismaClient, userId: string) {
  await base.membre.updateMany({
    where: { userId, OR: [{ pinEchecs: { gt: 0 } }, { pinBloqueJusqua: { not: null } }] },
    data: { pinEchecs: 0, pinBloqueJusqua: null },
  });
}

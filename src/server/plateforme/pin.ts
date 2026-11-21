import "server-only";
import { verifyPassword } from "better-auth/crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { MAX_ECHECS_PIN, apresEchecPin, pinBloque } from "@/lib/pin";
import { hacherPin } from "./comptes";
import { prismaPlateforme } from "./db";

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
  return enregistrerEchecPin(base, membre.id, maintenant);
}

/** One wrong PIN: atomic increment, then block once the threshold is reached. */
async function enregistrerEchecPin(
  base: PrismaClient,
  membreId: string,
  maintenant: Date,
): Promise<Extract<ResultatPin, { statut: "incorrect" | "bloque" }>> {
  const { pinEchecs } = await base.membre.update({
    where: { id: membreId },
    data: { pinEchecs: { increment: 1 } },
    select: { pinEchecs: true },
  });
  const suivant = apresEchecPin({ pinEchecs: pinEchecs - 1, pinBloqueJusqua: null }, maintenant);
  if (suivant.pinBloqueJusqua) {
    await base.membre.update({
      where: { id: membreId },
      data: { pinBloqueJusqua: suivant.pinBloqueJusqua },
    });
    return { statut: "bloque" };
  }
  return { statut: "incorrect", essaisRestants: MAX_ECHECS_PIN - pinEchecs };
}

export type ResultatConfirmationPin =
  | { statut: "confirme"; userId: string; membreId: string; nom: string }
  | { statut: "meme_compte" }
  | { statut: "non_autorise" }
  | Exclude<ResultatPin, { statut: "deverrouille" }>;

/**
 * A second person confirms an action on the agent's tablet with their own PIN (cahier
 * §7.6: retrieval without card or code, exceptional retrieval). The person must be another
 * account than the agent's, an active member of the church with one of the roles required.
 * Failures count against the same PIN counter as unlocking: five wrong PINs block it.
 */
export async function confirmerAvecPin(
  base: PrismaClient,
  demande: {
    egliseId: string;
    membreId: string;
    /** The agent signed in on the tablet: never their own confirmation. */
    agentUserId: string;
    roles: readonly Role[];
  },
  pin: string,
  maintenant: Date,
): Promise<ResultatConfirmationPin> {
  const membre = await base.membre.findFirst({
    where: { id: demande.membreId, egliseId: demande.egliseId },
    select: {
      id: true,
      userId: true,
      roles: true,
      actif: true,
      pinHash: true,
      pinEchecs: true,
      pinBloqueJusqua: true,
      user: { select: { actif: true, name: true } },
    },
  });
  if (!membre?.actif || !membre.user.actif) return { statut: "non_autorise" };
  if (membre.userId === demande.agentUserId) return { statut: "meme_compte" };
  if (!membre.roles.some((r) => demande.roles.includes(r))) return { statut: "non_autorise" };
  if (!membre.pinHash) return { statut: "non_defini" };
  if (pinBloque(membre, maintenant)) return { statut: "bloque" };

  if (await verifyPassword({ hash: membre.pinHash, password: pin })) {
    if (membre.pinEchecs > 0) {
      await base.membre.update({
        where: { id: membre.id },
        data: { pinEchecs: 0, pinBloqueJusqua: null },
      });
    }
    return {
      statut: "confirme",
      userId: membre.userId,
      membreId: membre.id,
      nom: membre.user.name,
    };
  }
  return enregistrerEchecPin(base, membre.id, maintenant);
}

/** Roles of the second member of a retrieval without card or code (cahier §7.6). */
export const ROLES_SECOND_MEMBRE = ["ACCUEIL", "RESPONSABLE", "ADMIN"] as const satisfies Role[];

/** Roles of the person who authorises an exceptional retrieval (cahier §7.6). */
export const ROLES_AUTORISATION_RETRAIT = ["RESPONSABLE", "ADMIN"] as const satisfies Role[];

/** Same two readers with the shared platform client (actions), bound to the agent's church. */
export const confirmerAvecPinEglise = (
  demande: Parameters<typeof confirmerAvecPin>[1],
  pin: string,
) => confirmerAvecPin(prismaPlateforme(), demande, pin, new Date());
export const membresConfirmateursEglise = (demande: Parameters<typeof membresConfirmateurs>[1]) =>
  membresConfirmateurs(prismaPlateforme(), demande);

/** Members who may confirm on the agent's tablet: other accounts, active, with a PIN. */
export async function membresConfirmateurs(
  base: PrismaClient,
  demande: { egliseId: string; agentUserId: string; roles: readonly Role[] },
): Promise<{ membreId: string; nom: string }[]> {
  const membres = await base.membre.findMany({
    where: {
      egliseId: demande.egliseId,
      actif: true,
      user: { actif: true },
      userId: { not: demande.agentUserId },
      roles: { hasSome: [...demande.roles] },
      pinHash: { not: null },
    },
    select: { id: true, user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return membres.map((m) => ({ membreId: m.id, nom: m.user.name }));
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

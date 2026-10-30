import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { INTERVALLE_ENREGISTREMENT_MS } from "@/lib/activite";
import { prismaPlateforme } from "./db";

export type EgliseAccessible = {
  id: string;
  nom: string;
  logoKey: string | null;
};

/** Churches the account may enter: active membership in an active church. */
export async function eglisesDuCompte(
  base: PrismaClient,
  userId: string,
): Promise<EgliseAccessible[]> {
  const membres = await base.membre.findMany({
    where: { userId, actif: true, user: { actif: true }, eglise: { statut: "ACTIVE" } },
    select: { eglise: { select: { id: true, nom: true, logoKey: true } } },
    orderBy: { eglise: { nom: "asc" } },
  });
  return membres.map((m) => m.eglise);
}

/**
 * Sets the active church of a session. The church id comes from the person's
 * choice, but access is granted only if they are an active member of it.
 */
export async function choisirEgliseActive(
  base: PrismaClient,
  session: { sessionId: string; userId: string },
  egliseId: string,
): Promise<boolean> {
  const accessibles = await eglisesDuCompte(base, session.userId);
  if (!accessibles.some((e) => e.id === egliseId)) return false;
  const { count } = await base.authSession.updateMany({
    where: { id: session.sessionId, userId: session.userId },
    data: { egliseActiveId: egliseId },
  });
  return count === 1;
}

/**
 * Records user activity, at most once per minute: the condition is evaluated in
 * the UPDATE itself, so concurrent requests write at most once.
 */
export async function enregistrerActivite(
  base: PrismaClient,
  sessionId: string,
  maintenant: Date,
): Promise<boolean> {
  const seuil = new Date(maintenant.getTime() - INTERVALLE_ENREGISTREMENT_MS);
  const { count } = await base.authSession.updateMany({
    where: {
      id: sessionId,
      OR: [{ derniereActivite: null }, { derniereActivite: { lte: seuil } }],
    },
    data: { derniereActivite: maintenant },
  });
  return count === 1;
}

/** Same as enregistrerActivite, on the shared client (used by lib/session.ts). */
export async function noterActiviteSession(sessionId: string, maintenant: Date) {
  return enregistrerActivite(prismaPlateforme(), sessionId, maintenant);
}

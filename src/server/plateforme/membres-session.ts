import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ContexteEglise } from "@/lib/tenant";
import type { LectureMembre, MembreAffectable } from "@/server/moniteurs-session";
import { prismaPlateforme } from "./db";

/**
 * Members of the active church for the monitors of a session (cahier §7.2). `Membre` is a
 * platform table: the services of src/server/moniteurs-session.ts receive these readers,
 * always bound to the church of the session context.
 */

export function lectureMembre(
  base: PrismaClient,
  contexte: Pick<ContexteEglise, "egliseId">,
): LectureMembre {
  return async (membreId) => {
    const membre = await base.membre.findFirst({
      where: { id: membreId, egliseId: contexte.egliseId },
      select: { actif: true, roles: true, user: { select: { actif: true } } },
    });
    if (!membre) return null;
    return {
      actif: membre.actif && membre.user.actif,
      moniteur: membre.roles.includes("MONITEUR"),
    };
  };
}

/** Active members of the church, by name: monitors to select, others as reinforcements. */
export async function membresAffectables(
  base: PrismaClient,
  contexte: Pick<ContexteEglise, "egliseId">,
): Promise<MembreAffectable[]> {
  const membres = await base.membre.findMany({
    where: { egliseId: contexte.egliseId, actif: true, user: { actif: true } },
    select: { id: true, roles: true, user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return membres
    .filter((m) => !m.roles.includes("ECRAN"))
    .map((m) => ({ membreId: m.id, nom: m.user.name, moniteur: m.roles.includes("MONITEUR") }));
}

/**
 * Names of accounts that are members of the church (who authorised, who handed over), by
 * user id; an account of another church is never named.
 */
export async function nomsMembres(
  base: PrismaClient,
  contexte: Pick<ContexteEglise, "egliseId">,
  userIds: string[],
): Promise<Map<string, string>> {
  const membres = await base.membre.findMany({
    where: { egliseId: contexte.egliseId, userId: { in: userIds } },
    select: { userId: true, user: { select: { name: true } } },
  });
  return new Map(membres.map((m) => [m.userId, m.user.name]));
}

/**
 * Active members of the church, by user id and name: who may accompany a child to the
 * infirmerie (lot 3). Never a member of another church.
 */
export async function membresActifs(
  base: PrismaClient,
  contexte: Pick<ContexteEglise, "egliseId">,
): Promise<{ userId: string; nom: string }[]> {
  const membres = await base.membre.findMany({
    where: { egliseId: contexte.egliseId, actif: true, user: { actif: true } },
    select: { userId: true, roles: true, user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return membres
    .filter((m) => !m.roles.includes("ECRAN"))
    .map((m) => ({ userId: m.userId, nom: m.user.name }));
}

/** Same readers with the shared platform client (pages, actions, routes). */
export const membresActifsEglise = (contexte: ContexteEglise) =>
  membresActifs(prismaPlateforme(), contexte);
export const nomsMembresEglise = (contexte: ContexteEglise, userIds: string[]) =>
  nomsMembres(prismaPlateforme(), contexte, userIds);
export const lectureMembreEglise = (contexte: ContexteEglise) =>
  lectureMembre(prismaPlateforme(), contexte);
export const membresAffectablesEglise = (contexte: ContexteEglise) =>
  membresAffectables(prismaPlateforme(), contexte);

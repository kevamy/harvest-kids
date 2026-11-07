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

/** Same readers with the shared platform client (pages, actions, routes). */
export const lectureMembreEglise = (contexte: ContexteEglise) =>
  lectureMembre(prismaPlateforme(), contexte);
export const membresAffectablesEglise = (contexte: ContexteEglise) =>
  membresAffectables(prismaPlateforme(), contexte);

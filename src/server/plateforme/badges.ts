import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { RechercheBadge } from "@/server/cartes/resolution";

/**
 * Monitor badges live on `Membre`, a platform table (outside RLS): they are read here,
 * always within the church taken from the session context, never from the request.
 */
export function rechercheBadge(base: PrismaClient, egliseId: string): RechercheBadge {
  return async (empreinte) => {
    const membre = await base.membre.findFirst({
      where: { egliseId, badgeTokenHash: empreinte, actif: true, user: { actif: true } },
      select: { id: true },
    });
    return membre ? { membreId: membre.id } : null;
  };
}

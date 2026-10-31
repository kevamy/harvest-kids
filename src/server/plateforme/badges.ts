import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ContexteEglise } from "@/lib/tenant";
import type { RechercheBadge } from "@/server/cartes/resolution";
import { prismaPlateforme } from "./db";

/**
 * Monitor badges live on `Membre`, a platform table (outside RLS): they are read here,
 * always within the church taken from the session context, never from the request.
 */
export function rechercheBadge(base: PrismaClient, contexte: ContexteEglise): RechercheBadge {
  return async (empreinte) => {
    const membre = await base.membre.findFirst({
      where: {
        egliseId: contexte.egliseId,
        badgeTokenHash: empreinte,
        actif: true,
        user: { actif: true },
      },
      select: { id: true },
    });
    return membre ? { membreId: membre.id } : null;
  };
}

/** Badge lookup of the active church, with the shared platform client (pages, actions). */
export function prismaPourBadges(contexte: ContexteEglise): RechercheBadge {
  return rechercheBadge(prismaPlateforme(), contexte);
}

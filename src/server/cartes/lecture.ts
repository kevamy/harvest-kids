import "server-only";
import type { ClientDeBase } from "@/lib/tenant";
import type { ResolutionJeton } from "./resolution";

/** Cards of a family, most recent first (family page). */
export function listerCartesFamille(db: Pick<ClientDeBase, "carteFamille">, familleId: string) {
  return db.carteFamille.findMany({
    where: { familleId },
    orderBy: { emiseLe: "desc" },
    take: 20,
    select: {
      id: true,
      emiseLe: true,
      activeLe: true,
      revoqueeLe: true,
      enfant: { select: { prenom: true, matricule: true } },
    },
  });
}

/**
 * What the verification screen shows for a resolved card: the family and the children it
 * opens (all the active children for a family card, the child for a child card). Read-only.
 */
export async function detailCarte(
  db: Pick<ClientDeBase, "famille">,
  resolution: Extract<ResolutionJeton, { familleId: string }>,
) {
  const famille = await db.famille.findUnique({
    where: { id: resolution.familleId },
    select: {
      id: true,
      nom: true,
      enfants: {
        where: { actif: true, ...(resolution.enfantId ? { id: resolution.enfantId } : {}) },
        orderBy: { dateNaissance: "asc" },
        select: { prenom: true, matricule: true },
      },
    },
  });
  return famille;
}

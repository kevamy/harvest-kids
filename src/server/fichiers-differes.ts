import "server-only";
import { journaliser } from "@/lib/audit";
import { cleAppartientA } from "@/lib/fichiers";
import type { Stockage } from "@/lib/storage";
import type { ClientDeBase } from "@/lib/tenant";

/**
 * Deferred deletion of replaced files (old logo, old photo). A tablet still showing the
 * previous page keeps a working image: the file is deleted by the daily task, at least
 * 24 hours after it was replaced. A new file always gets a new key, so no browser cache
 * can serve the old one.
 */
export const DELAI_SUPPRESSION_FICHIER_MS = 24 * 60 * 60 * 1000;

export function dateSuppression(maintenant = new Date()): Date {
  return new Date(maintenant.getTime() + DELAI_SUPPRESSION_FICHIER_MS);
}

/** Schedules the deletion of a replaced file, in the caller's transaction (scoped client). */
export async function programmerSuppression(
  tx: Pick<ClientDeBase, "fichierASupprimer">,
  cle: string,
  maintenant = new Date(),
) {
  await tx.fichierASupprimer.createMany({
    // egliseId is added by the scoped client; a key already scheduled is left as it is.
    data: [{ cle, apresLe: dateSuppression(maintenant) }] as never,
    skipDuplicates: true,
  });
}

/**
 * Daily task: deletes the files whose date has passed, in the active church only. A key
 * outside the church's prefix is never deleted (it is dropped from the list). Idempotent:
 * a file already gone is simply removed from the list.
 */
export async function supprimerFichiersEchus(
  db: Pick<ClientDeBase, "fichierASupprimer" | "auditLog">,
  egliseId: string,
  stockage: Stockage,
  maintenant = new Date(),
): Promise<number> {
  const echus = await db.fichierASupprimer.findMany({
    where: { apresLe: { lte: maintenant } },
    select: { id: true, cle: true },
  });
  for (const { id, cle } of echus) {
    if (cleAppartientA(cle, egliseId)) await stockage.delete(cle);
    await db.fichierASupprimer.delete({ where: { id } });
    await journaliser(
      db,
      { userId: null, appareil: "tache-quotidienne" },
      {
        action: "fichier.supprime",
        entite: "FichierASupprimer",
        entiteId: id,
      },
    );
  }
  return echus.length;
}

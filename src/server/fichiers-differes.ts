import "server-only";
import { randomUUID } from "node:crypto";
import { journaliser } from "@/lib/audit";
import { cleAppartientA } from "@/lib/fichiers";
import type { Stockage } from "@/lib/storage";
import type { ClientDeBase } from "@/lib/tenant";

/**
 * Deferred deletion of replaced files (old logo, old photo). A tablet still showing the
 * previous page keeps a working image: the file is deleted by the daily task, at least
 * 24 hours after it was replaced. A new file always gets a new key, so no browser cache
 * can serve the old one.
 *
 * One clock: the date is set and compared by PostgreSQL (`now()`), never by Node.
 */

/** Raw SQL inside a church transaction (scoped client or platform `withEglise`). */
type ExecutionBrute = {
  $executeRaw(requete: TemplateStringsArray, ...valeurs: unknown[]): PromiseLike<number>;
};

/**
 * Schedules the deletion of a replaced file, 24 hours from now, in the caller's
 * transaction. The church is the active one (`hk_eglise_active()`, under RLS); a key
 * already scheduled is left as it is.
 */
export async function programmerSuppression(tx: ExecutionBrute, cle: string) {
  await tx.$executeRaw`
    INSERT INTO "FichierASupprimer" (id, "egliseId", cle, "apresLe")
    VALUES (${randomUUID()}, hk_eglise_active(), ${cle}, now() + interval '24 hours')
    ON CONFLICT ("egliseId", cle) DO NOTHING`;
}

/**
 * Daily task: deletes the files whose date has passed, in the active church only. A key
 * outside the church's prefix is never deleted (it is dropped from the list). Idempotent:
 * a file already gone is simply removed from the list.
 */
export async function supprimerFichiersEchus(
  db: Pick<ClientDeBase, "fichierASupprimer" | "auditLog" | "$queryRaw">,
  egliseId: string,
  stockage: Stockage,
): Promise<number> {
  const echus = await db.$queryRaw<{ id: string; cle: string }[]>`
    SELECT id, cle FROM "FichierASupprimer" WHERE "apresLe" <= now() ORDER BY "apresLe", id`;
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

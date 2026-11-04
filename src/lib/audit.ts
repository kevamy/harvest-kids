import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { ClientDeBase, ContexteEglise } from "@/lib/tenant";

/**
 * Audit log of a church (RG-09). Written in the same transaction as the change
 * it records; the table only accepts inserts. Never put personal data in
 * `action` or `entite`: identifiers and before/after values only.
 */
export async function journaliser(
  db: Pick<ClientDeBase, "auditLog">,
  // userId null: the daily task (no user), never a request without a session.
  contexte:
    | { userId: string | null; appareil: string | null }
    | Pick<ContexteEglise, "userId" | "appareil">,
  entree: {
    action: string;
    entite: string;
    entiteId: string;
    avant?: Prisma.InputJsonValue;
    apres?: Prisma.InputJsonValue;
  },
) {
  await db.auditLog.create({
    // egliseId is added by the scoped client.
    data: {
      userId: contexte.userId,
      appareil: contexte.appareil,
      action: entree.action,
      entite: entree.entite,
      entiteId: entree.entiteId,
      avant: entree.avant,
      apres: entree.apres,
    } as Prisma.AuditLogUncheckedCreateInput,
  });
}

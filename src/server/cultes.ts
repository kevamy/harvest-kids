import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { journaliser } from "@/lib/audit";
import { schemaCulte } from "@/lib/cultes";
import type { ClientDeBase, ContexteEglise } from "@/lib/tenant";

/**
 * Recurring services of a church (cahier §7.2, §7.10), managed by an ADMIN or a RESPONSABLE.
 * Their hours are the church's local time (RG-12). A service is deactivated, never deleted:
 * its sessions keep pointing to it. New hours apply to the sessions created afterwards.
 */

type Tx = Pick<ClientDeBase, "culte" | "auditLog">;
type Auteur = Pick<ContexteEglise, "userId" | "appareil">;

export function listerCultes(db: Pick<ClientDeBase, "culte">) {
  return db.culte.findMany({
    orderBy: [{ jour: "asc" }, { heureDebut: "asc" }, { nom: "asc" }],
    select: { id: true, nom: true, jour: true, heureDebut: true, heureFin: true, actif: true },
  });
}

export async function creerCulte(tx: Tx, auteur: Auteur, saisie: unknown) {
  const donnees = schemaCulte.parse(saisie);
  const culte = await tx.culte.create({
    // egliseId is added by the scoped client.
    data: donnees as Prisma.CulteUncheckedCreateInput,
    select: { id: true },
  });
  await journaliser(tx, auteur, {
    action: "culte.cree",
    entite: "Culte",
    entiteId: culte.id,
    apres: donnees,
  });
  return culte;
}

/** Returns false when the service does not exist in the active church. */
export async function modifierCulte(
  tx: Tx,
  auteur: Auteur,
  culteId: string,
  saisie: unknown,
): Promise<boolean> {
  const donnees = schemaCulte.parse(saisie);
  const avant = await tx.culte.findUnique({
    where: { id: culteId },
    select: { nom: true, jour: true, heureDebut: true, heureFin: true, actif: true },
  });
  if (!avant) return false;
  await tx.culte.update({ where: { id: culteId }, data: donnees });
  await journaliser(tx, auteur, {
    action: "culte.modifie",
    entite: "Culte",
    entiteId: culteId,
    avant,
    apres: donnees,
  });
  return true;
}

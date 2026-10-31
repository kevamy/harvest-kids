import "server-only";
import { notFound } from "next/navigation";
import { peut, type Action } from "@/lib/rbac";
import { AccesRefuse, getTenantDb } from "@/lib/tenant";

/**
 * Page-level guard: a layout never protects a page (they render in parallel).
 * Without one of the actions, the page answers 404. Without access to the church
 * (locked tablet, no church chosen…), it returns null: the layout already shows the
 * lock screen or redirects, and the page renders nothing.
 */
export async function contextePage(...actions: Action[]) {
  try {
    const acces = await getTenantDb();
    if (!actions.some((action) => peut(acces.contexte.roles, action))) notFound();
    return acces;
  } catch (erreur) {
    if (erreur instanceof AccesRefuse) return null;
    throw erreur;
  }
}

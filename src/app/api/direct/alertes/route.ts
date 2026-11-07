import { NextResponse } from "next/server";
import { peut } from "@/lib/rbac";
import { AccesRefuse, getTenantDb } from "@/lib/tenant";
import { alertesClasses } from "@/server/moniteurs-session";

/**
 * Class alerts of the reception and RESPONSABLE dashboards (cahier §7.2.5, §7.9), polled
 * live (useLiveQuery): never counts as activity.
 */
export async function GET() {
  let acces: Awaited<ReturnType<typeof getTenantDb>>;
  try {
    acces = await getTenantDb({ rafraichissementAuto: true });
  } catch (erreur) {
    if (erreur instanceof AccesRefuse) return new Response(null, { status: 401 });
    throw erreur;
  }
  if (!peut(acces.contexte.roles, "alertes.voir")) return new Response(null, { status: 403 });
  return NextResponse.json(await alertesClasses(acces.db), {
    headers: { "Cache-Control": "no-store" },
  });
}

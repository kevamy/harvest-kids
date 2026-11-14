import { NextResponse } from "next/server";
import { peut } from "@/lib/rbac";
import { AccesRefuse, getTenantDb } from "@/lib/tenant";
import { alertesClasses, type AlerteClasse } from "@/server/moniteurs-session";
import { lireParametres } from "@/server/parametres";
import { alertesNonArrives, type AlerteNonArrive } from "@/server/salle";

export type AlertesDirect = { classes: AlerteClasse[]; nonArrives: AlerteNonArrive[] };

/**
 * Alerts of the reception and RESPONSABLE dashboards, polled live (useLiveQuery): never
 * counts as activity. Classes under their minimum of monitors (cahier §7.2.5) and children
 * not arrived in class after the church's delay (§7.4).
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
  const parametres = await lireParametres(acces.db);
  const [classes, nonArrives] = await Promise.all([
    alertesClasses(acces.db),
    alertesNonArrives(acces.db, parametres["presences.delaiNonArriveEnSalleMinutes"]),
  ]);
  const corps: AlertesDirect = { classes, nonArrives };
  return NextResponse.json(corps, { headers: { "Cache-Control": "no-store" } });
}

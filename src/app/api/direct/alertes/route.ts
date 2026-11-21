import { NextResponse } from "next/server";
import { peut } from "@/lib/rbac";
import { AccesRefuse, getTenantDb } from "@/lib/tenant";
import { alertesClasses, type AlerteClasse } from "@/server/moniteurs-session";
import { lireParametres } from "@/server/parametres";
import {
  sessionsCodesBloquesEglise,
  tablettesBloqueesEglise,
} from "@/server/plateforme/limitation";
import { alertesNonArrives, type AlerteNonArrive } from "@/server/salle";

export type AlertesDirect = {
  classes: AlerteClasse[];
  nonArrives: AlerteNonArrive[];
  /** Tablets blocked after 5 wrong retrieval codes (cahier §7.6, ADR 0016). */
  tablettesBloquees: { sessionId: string; minutes: number }[];
  /**
   * Open sessions where 20 wrong codes, every tablet together, blocked code entry for the
   * rest of the session (ADR 0016), with the name of their worship service.
   */
  sessionsCodesBloques: { sessionId: string; culte: string | null }[];
};

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
  const [classes, nonArrives, bloquees, sessionsBloquees] = await Promise.all([
    alertesClasses(acces.db),
    alertesNonArrives(acces.db, parametres["presences.delaiNonArriveEnSalleMinutes"]),
    tablettesBloqueesEglise(acces.contexte.egliseId),
    sessionsCodesBloquesEglise(acces.contexte.egliseId),
  ]);
  // Only sessions still open: once closed, nobody picks a child up there any more.
  const sessionsOuvertes =
    sessionsBloquees.length === 0
      ? []
      : await acces.db.session.findMany({
          where: { id: { in: sessionsBloquees }, statut: "OUVERTE" },
          select: { id: true, debut: true, culte: { select: { nom: true } } },
          orderBy: { debut: "asc" },
        });
  const corps: AlertesDirect = {
    classes,
    nonArrives,
    tablettesBloquees: bloquees.map((t) => ({
      sessionId: t.sessionId,
      minutes: Math.max(1, Math.ceil(t.reessayerDansMs / 60_000)),
    })),
    sessionsCodesBloques: sessionsOuvertes.map((s) => ({
      sessionId: s.id,
      culte: s.culte?.nom ?? null,
    })),
  };
  return NextResponse.json(corps, { headers: { "Cache-Control": "no-store" } });
}

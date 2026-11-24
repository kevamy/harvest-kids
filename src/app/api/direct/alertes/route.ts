import { NextResponse } from "next/server";
import { peut } from "@/lib/rbac";
import { AccesRefuse, getTenantDb } from "@/lib/tenant";
import { alertesClasses, type AlerteClasse } from "@/server/moniteurs-session";
import { listeInfirmerie, type EnfantInfirmerie } from "@/server/infirmerie";
import { lireParametres } from "@/server/parametres";
import {
  sessionsCodesBloquesEglise,
  tablettesBloqueesEglise,
} from "@/server/plateforme/limitation";
import { alertesNonArrives, type AlerteNonArrive } from "@/server/salle";

export type AlertesDirect = {
  /** Children at the infirmerie or on their way (lot 3), the ones not arrived first. */
  infirmerie: Pick<
    EnfantInfirmerie,
    "presenceId" | "prenom" | "matricule" | "classe" | "depuisMinutes" | "enRoute" | "nonArrive"
  >[];
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
  const [infirmerie, classes, nonArrives, bloquees, sessionsBloquees] = await Promise.all([
    listeInfirmerie(acces.db, parametres["infirmerie.delaiReceptionMinutes"]),
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
    // Matricule, first name and class only: the card behind the link checks the rights.
    infirmerie: infirmerie.map((e) => ({
      presenceId: e.presenceId,
      prenom: e.prenom,
      matricule: e.matricule,
      classe: e.classe,
      depuisMinutes: e.depuisMinutes,
      enRoute: e.enRoute,
      nonArrive: e.nonArrive,
    })),
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

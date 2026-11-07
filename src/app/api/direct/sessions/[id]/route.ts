import { NextResponse } from "next/server";
import type { StatutSession } from "@/generated/prisma/enums";
import { peut } from "@/lib/rbac";
import { AccesRefuse, getTenantDb } from "@/lib/tenant";
import { affectationActive, etatClasses, type EtatClasse } from "@/server/moniteurs-session";
import { membresAffectablesEglise } from "@/server/plateforme/membres-session";

export type EtatSessionDirect = {
  statut: StatutSession;
  classes: (Omit<EtatClasse, "moniteurs"> & {
    moniteurs: { membreId: string; nom: string; renfort: boolean }[];
  })[];
  /** The class of the signed-in member in this session, if any. */
  maClasse: string | null;
};

/**
 * Live state of a session's classes (cahier §7.2), polled by the sessions and class screens
 * (useLiveQuery): never counts as activity. Same answer for another church's session and a
 * missing one.
 */
export async function GET(
  _requete: Request,
  { params }: RouteContext<"/api/direct/sessions/[id]">,
) {
  let acces: Awaited<ReturnType<typeof getTenantDb>>;
  try {
    acces = await getTenantDb({ rafraichissementAuto: true });
  } catch (erreur) {
    if (erreur instanceof AccesRefuse) return new Response(null, { status: 401 });
    throw erreur;
  }
  const { db, contexte } = acces;
  if (!peut(contexte.roles, "sessions.gerer") && !peut(contexte.roles, "classe.voir")) {
    return new Response(null, { status: 403 });
  }

  const { id } = await params;
  const session = await db.session.findUnique({ where: { id }, select: { statut: true } });
  if (!session) return new Response(null, { status: 404 });

  const [classes, membres, mienne] = await Promise.all([
    etatClasses(db, id),
    membresAffectablesEglise(contexte),
    affectationActive(db, contexte.membreId),
  ]);
  const noms = new Map(membres.map((m) => [m.membreId, m.nom]));
  const corps: EtatSessionDirect = {
    statut: session.statut,
    classes: classes.map((c) => ({
      ...c,
      moniteurs: c.moniteurs.map((m) => ({ ...m, nom: noms.get(m.membreId) ?? "Membre" })),
    })),
    maClasse: mienne?.sessionId === id ? mienne.classeId : null,
  };
  return NextResponse.json(corps, { headers: { "Cache-Control": "no-store" } });
}

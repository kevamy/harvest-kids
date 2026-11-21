import { NextResponse } from "next/server";
import { droitsSalle } from "@/lib/rbac";
import { AccesRefuse, getTenantDb } from "@/lib/tenant";
import { lireParametres } from "@/server/parametres";
import { classeDeSession, estAffecte, listeDeClasse, type EnfantSalle } from "@/server/salle";

export type ListeClasseDirect = {
  sessionOuverte: boolean;
  enfants: EnfantSalle[];
  droits: { confirmer: boolean; corriger: boolean };
};

/**
 * Live list of a class in a session (cahier §7.4), polled by the class screen
 * (useLiveQuery): never counts as activity. Seen by the members assigned to the class and
 * by a RESPONSABLE or an ADMIN (droitsSalle); the same 404 for another church's class, a
 * missing one or a class the member may not see.
 */
export async function GET(_requete: Request, { params }: RouteContext<"/api/direct/classes/[id]">) {
  let acces: Awaited<ReturnType<typeof getTenantDb>>;
  try {
    acces = await getTenantDb({ rafraichissementAuto: true });
  } catch (erreur) {
    if (erreur instanceof AccesRefuse) return new Response(null, { status: 401 });
    throw erreur;
  }
  const { db, contexte } = acces;
  const { id } = await params;
  const classe = await classeDeSession(db, id);
  if (!classe) return new Response(null, { status: 404 });
  const droits = droitsSalle(contexte.roles, await estAffecte(db, id, contexte.membreId));
  if (!droits.voir) return new Response(null, { status: 404 });

  const parametres = await lireParametres(db);
  const corps: ListeClasseDirect = {
    sessionOuverte: classe.sessionOuverte,
    enfants: await listeDeClasse(
      db,
      classe,
      contexte.userId,
      parametres["presences.delaiNonArriveEnSalleMinutes"],
    ),
    droits: { confirmer: droits.confirmer, corriger: droits.corriger },
  };
  return NextResponse.json(corps, { headers: { "Cache-Control": "no-store" } });
}

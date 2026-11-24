import { NextResponse } from "next/server";
import { AccesRefuse, getTenantDb } from "@/lib/tenant";
import { lireFiche, presenceAutorisee } from "@/app/(app)/presences/acces-presence";

/**
 * Live card of a child's presence (lot 3), polled by the card (useLiveQuery): never counts
 * as activity. The same 404 for another church's presence, a missing one or a child the
 * member may not reach (droitsPresence).
 */
export async function GET(
  _requete: Request,
  { params }: RouteContext<"/api/direct/presences/[id]">,
) {
  let acces: Awaited<ReturnType<typeof getTenantDb>>;
  try {
    acces = await getTenantDb({ rafraichissementAuto: true });
  } catch (erreur) {
    if (erreur instanceof AccesRefuse) return new Response(null, { status: 401 });
    throw erreur;
  }
  const autorisee = await presenceAutorisee(acces, (await params).id);
  if (!autorisee) return new Response(null, { status: 404 });
  return NextResponse.json(await lireFiche(acces, autorisee), {
    headers: { "Cache-Control": "no-store" },
  });
}

import { NextResponse, type NextRequest } from "next/server";
import {
  ecranDeLAppareilPublic,
  egliseDeLEcranPublic,
  tuilesEcranPublic,
  type TuileEcran,
} from "@/server/plateforme/ecran";
import { ENTETES_ECRAN, lireCookieEcran, poserCookieEcran } from "../cookie";

export type EcranDirect = {
  eglise: { nom: string; logo: boolean };
  ecran: string;
  tuiles: TuileEcran[];
};

/**
 * Live tiles of a paired call screen (ADR 0018), polled every 3 s. The church comes from the
 * device's cookie, never from the address: a device of another church gets 404, an unpaired
 * one 401, a revoked one 410. Matricules and places only (RG-10).
 */
export async function GET(requete: NextRequest, { params }: RouteContext<"/api/ecran/[slug]">) {
  const { slug } = await params;
  const secret = lireCookieEcran(requete);
  if (!secret) return new Response(null, { status: 401, headers: ENTETES_ECRAN });
  const ecran = await ecranDeLAppareilPublic(slug, secret);
  if (ecran.etat === "revoque") return new Response(null, { status: 410, headers: ENTETES_ECRAN });
  if (ecran.etat === "inconnu") return new Response(null, { status: 404, headers: ENTETES_ECRAN });

  const [eglise, tuiles] = await Promise.all([
    egliseDeLEcranPublic(ecran.egliseId),
    tuilesEcranPublic(ecran.egliseId),
  ]);
  const corps: EcranDirect = {
    eglise: { nom: eglise.nom, logo: eglise.logoKey !== null },
    ecran: ecran.nom,
    tuiles,
  };
  const reponse = NextResponse.json(corps, { headers: ENTETES_ECRAN });
  // Renewed at most once a minute, with the last view: a screen in use never expires.
  if (ecran.renouveler) poserCookieEcran(reponse, secret);
  return reponse;
}

import { NextResponse, type NextRequest } from "next/server";
import { appairerEcranPublic } from "@/server/plateforme/ecran";
import { ENTETES_ECRAN, poserCookieEcran } from "../../cookie";

/**
 * Pairing of a call screen (ADR 0018): the page reads the link's fragment (never sent to a
 * server log) and posts it here once; the answer sets the device's cookie. Public route
 * (no session): the link is the proof, consumed once, attempts limited.
 */
export async function POST(
  requete: NextRequest,
  { params }: RouteContext<"/api/ecran/[slug]/appairage">,
) {
  const { slug } = await params;
  let jeton = "";
  try {
    const corps = (await requete.json()) as { jeton?: unknown };
    if (typeof corps.jeton === "string") jeton = corps.jeton.trim();
  } catch {
    // An unreadable body is an invalid link, counted like any other attempt.
  }
  const ip = requete.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "inconnue";
  const resultat = await appairerEcranPublic(slug, jeton, ip);
  if (!resultat.ok) {
    return NextResponse.json(
      { message: resultat.message },
      { status: 400, headers: ENTETES_ECRAN },
    );
  }
  const reponse = NextResponse.json({ nom: resultat.nom }, { headers: ENTETES_ECRAN });
  poserCookieEcran(reponse, resultat.secret);
  return reponse;
}

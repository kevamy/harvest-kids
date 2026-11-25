import type { NextRequest } from "next/server";
import { stockage } from "@/lib/storage";
import { ecranDeLAppareilPublic, egliseDeLEcranPublic } from "@/server/plateforme/ecran";
import { lireCookieEcran } from "../../cookie";

/**
 * The church's logo on its call screen (light variant first). Same device check as the
 * tiles: the church comes from the cookie, never from the address.
 */
export async function GET(
  requete: NextRequest,
  { params }: RouteContext<"/api/ecran/[slug]/logo">,
) {
  const { slug } = await params;
  const ecran = await ecranDeLAppareilPublic(slug, lireCookieEcran(requete));
  if (ecran.etat !== "actif") return new Response(null, { status: 404 });
  const { logoKey } = await egliseDeLEcranPublic(ecran.egliseId);
  const fichier = logoKey ? await stockage().get(logoKey) : null;
  if (!fichier) return new Response(null, { status: 404 });
  return new Response(Buffer.from(fichier.donnees), {
    headers: {
      "Content-Type": fichier.typeContenu,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

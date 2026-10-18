import { cleAppartientA } from "@/lib/fichiers";
import { stockage } from "@/lib/storage";
import { AccesRefuse, getEgliseActive } from "@/lib/tenant";

const INTROUVABLE = () => new Response(null, { status: 404 });

/**
 * Authenticated file route (RG-11, RG-15). A file is served only if its key lies
 * under the active church's prefix; any other key answers 404, exactly like a
 * missing file, so the existence of another church's file cannot be guessed.
 */
export async function GET(_requete: Request, { params }: RouteContext<"/api/fichiers/[...cle]">) {
  let egliseId: string;
  try {
    // Loading an image is not user activity (it also happens on live screens).
    ({ egliseId } = await getEgliseActive({ rafraichissementAuto: true }));
  } catch (erreur) {
    if (erreur instanceof AccesRefuse) return new Response(null, { status: 401 });
    throw erreur;
  }

  const cle = (await params).cle.join("/");
  if (!cleAppartientA(cle, egliseId)) return INTROUVABLE();

  const fichier = await stockage().get(cle);
  if (!fichier) return INTROUVABLE();

  return new Response(Buffer.from(fichier.donnees), {
    headers: {
      "Content-Type": fichier.typeContenu,
      // Personal data: never kept by shared caches.
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}

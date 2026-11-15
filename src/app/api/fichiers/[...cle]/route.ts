import { analyserCle } from "@/lib/fichiers";
import { peut } from "@/lib/rbac";
import { stockage } from "@/lib/storage";
import { AccesRefuse, getEgliseActive } from "@/lib/tenant";

const INTROUVABLE = () => new Response(null, { status: 404 });

/**
 * Authenticated file route (RG-11, RG-15). A file is served only if its key lies
 * under the active church's prefix; any other key answers 404, exactly like a
 * missing file, so the existence of another church's file cannot be guessed.
 */
export async function GET(_requete: Request, { params }: RouteContext<"/api/fichiers/[...cle]">) {
  let contexte: Awaited<ReturnType<typeof getEgliseActive>>;
  try {
    // Loading an image is not user activity (it also happens on live screens).
    contexte = await getEgliseActive({ rafraichissementAuto: true });
  } catch (erreur) {
    if (erreur instanceof AccesRefuse) return new Response(null, { status: 401 });
    throw erreur;
  }

  const cle = (await params).cle.join("/");
  const analyse = analyserCle(cle);
  if (analyse?.egliseId !== contexte.egliseId) return INTROUVABLE();
  // The photo of an adult not recognised at check-out: RESPONSABLE and ADMIN only, and the
  // same 404 for anyone else (cahier §7.6).
  if (analyse.categorie === "retraits" && !peut(contexte.roles ?? [], "incidents.voir")) {
    return INTROUVABLE();
  }

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

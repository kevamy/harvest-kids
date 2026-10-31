import { peut } from "@/lib/rbac";
import { AccesRefuse, getEgliseActive } from "@/lib/tenant";
import { pdfEssai } from "@/server/impression/cartes";
import { IDS_FORMAT, type IdFormat } from "@/server/impression/formats";
import { informationsImpression } from "@/server/plateforme/profil-eglise";

export const dynamic = "force-dynamic";

/**
 * Test card in a given format (Paramètres › Impression): fictitious family, marked
 * "Essai", token registered nowhere. Read-only: nothing is written.
 */
export async function GET(requete: Request) {
  try {
    const contexte = await getEgliseActive();
    if (!peut(contexte.roles, "eglise.parametrer")) return new Response(null, { status: 404 });
    const parametres = new URL(requete.url).searchParams;
    const format = parametres.get("format");
    if (!format || !(IDS_FORMAT as readonly string[]).includes(format)) {
      return new Response(null, { status: 404 });
    }
    const sortie = parametres.get("sortie");
    const pdf = await pdfEssai(
      await informationsImpression(contexte),
      format as IdFormat,
      parametres.get("rectoVerso") === "1",
      sortie === "unitaire" || sortie === "planche" ? sortie : undefined,
    );
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="carte-essai-${format}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AccesRefuse) return new Response(null, { status: 401 });
    throw e;
  }
}

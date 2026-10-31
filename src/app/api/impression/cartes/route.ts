import { z } from "zod";
import { ActionInterdite, exigerDroit } from "@/lib/rbac";
import { AccesRefuse, getTenantDb } from "@/lib/tenant";
import { CarteImpossible } from "@/server/cartes/cycle";
import { ImpressionRefusee, imprimerCartesFamille } from "@/server/impression/cartes";
import { IDS_FORMAT } from "@/server/impression/formats";
import { informationsImpression } from "@/server/plateforme/profil-eglise";

export const dynamic = "force-dynamic";

const schema = z.object({
  familleId: z.string().min(1).max(40),
  format: z.enum(IDS_FORMAT).optional(),
  rectoVerso: z.boolean().optional(),
  sortie: z.enum(["unitaire", "planche"]).optional(),
  perdue: z.boolean().optional(),
});

const erreur = (statut: number, message: string) =>
  Response.json(
    { ok: false, erreur: message },
    { status: statut, headers: { "Cache-Control": "no-store" } },
  );

/**
 * Prints a family's cards (cahier §7.10): issues the cards and returns the PDF, the only
 * place where the clear tokens exist. Checks the session, the church and the role itself;
 * the family id only selects a family of the active church (scoped client). Same-origin
 * requests only (Origin header).
 */
export async function POST(requete: Request) {
  const origine = requete.headers.get("origin");
  if (!origine || new URL(origine).host !== requete.headers.get("host")) {
    return erreur(403, "Requête refusée.");
  }
  try {
    const { db, contexte } = await getTenantDb();
    exigerDroit(contexte, "familles.gerer");
    const choix = schema.safeParse(await requete.json().catch(() => null));
    if (!choix.success) return erreur(400, "Demande d'impression incomplète. Rechargez la page.");
    const { familleId, ...options } = choix.data;
    const { pdf, nomFichier } = await imprimerCartesFamille(
      db,
      contexte,
      familleId,
      await informationsImpression(contexte),
      options,
    );
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nomFichier}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AccesRefuse)
      return erreur(401, "Votre session est verrouillée ou a expiré. Reconnectez-vous.");
    if (e instanceof ActionInterdite)
      return erreur(403, "Vous n'avez pas le droit d'imprimer des cartes.");
    if (e instanceof ImpressionRefusee) return erreur(409, e.message);
    if (e instanceof CarteImpossible)
      return erreur(409, "Impression impossible pour cette famille. Rechargez la page.");
    throw e;
  }
}

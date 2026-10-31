import { z } from "zod";
import { ActionInterdite, exigerDroit } from "@/lib/rbac";
import { AccesRefuse, getTenantDb } from "@/lib/tenant";
import { CarteImpossible } from "@/server/cartes/cycle";
import { ImpressionRefusee } from "@/server/impression/cartes";
import { dateLimiteDepuisJour, reemettreCartes } from "@/server/impression/reemission";
import { informationsImpression, profilEglise } from "@/server/plateforme/profil-eglise";

export const dynamic = "force-dynamic";
// Every family of the church in one PDF and one transaction (60 s: the Vercel plan limit).
export const maxDuration = 60;

const schema = z.object({
  // Last day the old cards are accepted ("YYYY-MM-DD", church time zone), or none.
  dernierJour: z.string().max(10).nullable(),
});

const erreur = (statut: number, message: string) =>
  Response.json(
    { ok: false, erreur: message },
    { status: statut, headers: { "Cache-Control": "no-store" } },
  );

/**
 * Bulk reissue (RG-16): new pending cards for every finalised family in the current mode,
 * returned as one PDF, the only place where the clear tokens exist. ADMIN only; checks the
 * session, the church and the role itself. Same-origin requests only (Origin header).
 */
export async function POST(requete: Request) {
  const origine = requete.headers.get("origin");
  if (!origine || new URL(origine).host !== requete.headers.get("host")) {
    return erreur(403, "Requête refusée.");
  }
  try {
    const { db, contexte } = await getTenantDb();
    exigerDroit(contexte, "eglise.parametrer");
    const saisie = schema.safeParse(await requete.json().catch(() => null));
    if (!saisie.success) return erreur(400, "Demande de réémission incomplète. Rechargez la page.");
    const { dernierJour } = saisie.data;
    const dateLimite = dernierJour
      ? dateLimiteDepuisJour(dernierJour, (await profilEglise(contexte)).fuseau)
      : null;
    const { pdf, familles, cartes } = await reemettreCartes(
      db,
      contexte,
      await informationsImpression(contexte),
      { dateLimite },
    );
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="reemission-cartes.pdf"`,
        "Cache-Control": "no-store",
        "X-Familles": String(familles),
        "X-Cartes": String(cartes),
      },
    });
  } catch (e) {
    if (e instanceof AccesRefuse)
      return erreur(401, "Votre session est verrouillée ou a expiré. Reconnectez-vous.");
    if (e instanceof ActionInterdite)
      return erreur(403, "Vous n'avez pas le droit de réémettre les cartes.");
    if (e instanceof ImpressionRefusee) return erreur(409, e.message);
    if (e instanceof CarteImpossible)
      return erreur(409, "Réémission impossible : une famille a changé entre-temps. Recommencez.");
    throw e;
  }
}

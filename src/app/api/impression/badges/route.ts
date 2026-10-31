import { z } from "zod";
import { ActionInterdite, exigerDroit } from "@/lib/rbac";
import { AccesRefuse, getTenantDb } from "@/lib/tenant";
import { IDS_FORMAT } from "@/server/impression/formats";
import {
  BadgeImpossible,
  ImpressionBadgesRefusee,
  imprimerBadgesEglise,
} from "@/server/plateforme/badges";
import { informationsImpression } from "@/server/plateforme/profil-eglise";

export const dynamic = "force-dynamic";
// Every monitor of the church in one PDF and one transaction.
export const maxDuration = 60;

const schema = z.object({
  // Absent: every active monitor of the church.
  membreIds: z.array(z.string().min(1).max(40)).min(1).max(500).optional(),
  format: z.enum(IDS_FORMAT).optional(),
  rectoVerso: z.boolean().optional(),
  sortie: z.enum(["unitaire", "planche"]).optional(),
});

const erreur = (statut: number, message: string) =>
  Response.json(
    { ok: false, erreur: message },
    { status: statut, headers: { "Cache-Control": "no-store" } },
  );

/**
 * Prints monitor badges (cahier §7.10): issues the badges and returns the PDF, the only
 * place where the clear tokens exist. ADMIN only (comptes.gerer); checks the session, the
 * church and the role itself. Same-origin requests only (Origin header).
 */
export async function POST(requete: Request) {
  const origine = requete.headers.get("origin");
  if (!origine || new URL(origine).host !== requete.headers.get("host")) {
    return erreur(403, "Requête refusée.");
  }
  try {
    const { db, contexte } = await getTenantDb();
    exigerDroit(contexte, "comptes.gerer");
    const choix = schema.safeParse(await requete.json().catch(() => null));
    if (!choix.success) return erreur(400, "Demande d'impression incomplète. Rechargez la page.");
    const { pdf, badges } = await imprimerBadgesEglise(
      db,
      contexte,
      await informationsImpression(contexte),
      choix.data,
    );
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="badges-moniteurs.pdf"`,
        "Cache-Control": "no-store",
        "X-Badges": String(badges),
      },
    });
  } catch (e) {
    if (e instanceof AccesRefuse)
      return erreur(401, "Votre session est verrouillée ou a expiré. Reconnectez-vous.");
    if (e instanceof ActionInterdite)
      return erreur(403, "Vous n'avez pas le droit d'imprimer des badges.");
    if (e instanceof ImpressionBadgesRefusee) return erreur(409, e.message);
    if (e instanceof BadgeImpossible)
      return erreur(409, "Un moniteur a changé entre-temps. Rechargez la page et recommencez.");
    throw e;
  }
}

import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { tachesQuotidiennes } from "@/server/plateforme/taches";

export const dynamic = "force-dynamic";

/** Constant-time comparison (hashes of equal length, whatever the input lengths). */
function egaux(a: string, b: string) {
  const empreinte = (valeur: string) => createHash("sha256").update(valeur).digest();
  return timingSafeEqual(empreinte(a), empreinte(b));
}

/**
 * Daily task, called by Vercel Cron (production deployment only) and by a scheduled job
 * on the VPS (lot 5): `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET in the
 * environment, every call is refused. The answer holds counts only.
 */
export async function GET(requete: Request) {
  const secret = env().CRON_SECRET;
  const recu = requete.headers.get("authorization") ?? "";
  if (!secret || !egaux(recu, `Bearer ${secret}`)) {
    return Response.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const bilan = await tachesQuotidiennes();
  return Response.json(
    { ok: bilan.erreurs === 0, ...bilan },
    { status: bilan.erreurs === 0 ? 200 : 500, headers: { "Cache-Control": "no-store" } },
  );
}

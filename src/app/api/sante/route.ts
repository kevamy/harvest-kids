import { verifierSante } from "@/server/plateforme/sante";

export const dynamic = "force-dynamic";

/**
 * Public health check (Docker healthcheck, Caddy, deployment checks). Answers
 * only a status and a reason code: no version, no host, no personal data.
 */
export async function GET() {
  const etat = await verifierSante();
  return Response.json(etat, {
    status: etat.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

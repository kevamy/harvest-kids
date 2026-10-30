import "server-only";
import { prismaPlateforme } from "./db";

export type EtatSante =
  | { ok: true }
  | { ok: false; raison: "base_injoignable" | "role_interdit" | "migrations_absentes" };

type Controle = { interdit: boolean; schema: boolean };

/**
 * Health check for Docker, Caddy and the deployment checks. Beyond reachability,
 * the application must connect as hk_app: a connection string of the owner role
 * or of a role that can bypass Row-Level Security (Neon's neondb_owner is a member
 * of neon_superuser) would let one church read another's data, so the instance
 * then reports itself unhealthy.
 */
export async function verifierSante(): Promise<EtatSante> {
  let controle: Controle | undefined;
  try {
    const lignes = await prismaPlateforme().$queryRaw<Controle[]>`
      SELECT
        EXISTS (
          SELECT 1 FROM pg_roles r
          WHERE (r.rolsuper OR r.rolbypassrls)
            AND pg_has_role(current_user, r.oid, 'MEMBER')
        )
        OR COALESCE(pg_get_userbyid(c.relowner) = current_user, false) AS interdit,
        c.oid IS NOT NULL AS schema
      FROM (SELECT to_regclass('public."Eglise"') AS oid) e
      LEFT JOIN pg_class c ON c.oid = e.oid`;
    controle = lignes[0];
  } catch {
    return { ok: false, raison: "base_injoignable" };
  }
  if (!controle || controle.interdit) return { ok: false, raison: "role_interdit" };
  if (!controle.schema) return { ok: false, raison: "migrations_absentes" };
  return { ok: true };
}

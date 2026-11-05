import { peut } from "@/lib/rbac";
import { AccesRefuse, getTenantDb } from "@/lib/tenant";
import { modeleImport } from "@/server/import-familles/modele";

export const dynamic = "force-dynamic";

/**
 * Template of the family import (ADR 0013): UTF-8 with BOM and ";", column titles only,
 * so that no example line is ever imported by mistake. Checks the session, the church
 * and the right itself.
 */
export async function GET() {
  try {
    const { contexte } = await getTenantDb();
    if (!peut(contexte.roles, "familles.importer")) return new Response(null, { status: 404 });
    return new Response(modeleImport(), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="modele-import-familles.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AccesRefuse) return new Response(null, { status: 401 });
    throw e;
  }
}

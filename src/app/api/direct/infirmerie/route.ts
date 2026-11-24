import { NextResponse } from "next/server";
import { peut } from "@/lib/rbac";
import { AccesRefuse, getTenantDb } from "@/lib/tenant";
import { listeInfirmerie, type EnfantInfirmerie } from "@/server/infirmerie";
import { lireParametres } from "@/server/parametres";
import { nomsMembresEglise } from "@/server/plateforme/membres-session";

export type InfirmerieDirect = {
  enfants: (EnfantInfirmerie & { accompagnant: string | null })[];
  delaiReceptionMinutes: number;
};

/**
 * Live list of the infirmerie page (lot 3), polled with useLiveQuery: never counts as
 * activity. For the infirmerie, a RESPONSABLE and an ADMIN.
 */
export async function GET() {
  let acces: Awaited<ReturnType<typeof getTenantDb>>;
  try {
    acces = await getTenantDb({ rafraichissementAuto: true });
  } catch (erreur) {
    if (erreur instanceof AccesRefuse) return new Response(null, { status: 401 });
    throw erreur;
  }
  const { db, contexte } = acces;
  if (!peut(contexte.roles, "infirmerie.gerer") && !peut(contexte.roles, "salle.superviser")) {
    return new Response(null, { status: 403 });
  }
  const delai = (await lireParametres(db))["infirmerie.delaiReceptionMinutes"];
  const enfants = await listeInfirmerie(db, delai);
  const noms = await nomsMembresEglise(contexte, [
    ...new Set(enfants.map((e) => e.accompagnantUserId).filter((id): id is string => !!id)),
  ]);
  const corps: InfirmerieDirect = {
    delaiReceptionMinutes: delai,
    enfants: enfants.map((e) => ({
      ...e,
      accompagnant: e.accompagnantUserId ? (noms.get(e.accompagnantUserId) ?? null) : null,
    })),
  };
  return NextResponse.json(corps, { headers: { "Cache-Control": "no-store" } });
}

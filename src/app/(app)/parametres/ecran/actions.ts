"use server";

import { revalidatePath } from "next/cache";
import { creerEcranEglise, revoquerEcranEglise } from "@/server/plateforme/ecran";
import { RefusMetier, executerActionAvec, type ResultatAction } from "../../executer-action";

/**
 * Call screens of the church (ADR 0018), for the ADMIN (eglise.parametrer). The church is
 * the session's active church; the pairing link is returned once and never stored in clear.
 */

export async function ajouterEcran(nom: unknown) {
  const resultat = await executerActionAvec("eglise.parametrer", async ({ contexte }) => {
    const { lien } = await creerEcranEglise(contexte, nom);
    return { lien };
  });
  if (resultat.ok) revalidatePath("/parametres/ecran");
  return resultat;
}

export async function retirerEcran(ecranId: unknown): Promise<ResultatAction> {
  const resultat = await executerActionAvec("eglise.parametrer", async ({ contexte }) => {
    if (typeof ecranId !== "string" || !(await revoquerEcranEglise(contexte, ecranId))) {
      // Same answer for another church's screen, a missing one or one already revoked.
      throw new RefusMetier("Écran introuvable ou déjà retiré. Rechargez la page.");
    }
  });
  if (resultat.ok) revalidatePath("/parametres/ecran");
  return resultat.ok ? { ok: true } : resultat;
}

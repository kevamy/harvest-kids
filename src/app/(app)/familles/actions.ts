"use server";

import { stockage } from "@/lib/storage";
import { FamilleRefusee, enregistrerFamille, type FichierRecu } from "@/server/familles";
import { RefusMetier, executerAction } from "../executer-action";

export type ResultatFamille = { ok: true; familleId: string } | { ok: false; erreur: string };

/**
 * Registers a family, saves it, or finalises a draft (cahier §7.1). The form sends the
 * entries as JSON in `donnees` and each new photo as a file field `photo-…`. The family
 * id, when present, only selects a family of the active church (scoped client).
 */
export async function enregistrer(formulaire: FormData): Promise<ResultatFamille> {
  let familleId = "";
  const resultat = await executerAction("familles.gerer", async ({ db, contexte }) => {
    let saisie: unknown;
    try {
      saisie = JSON.parse(String(formulaire.get("donnees") ?? ""));
    } catch {
      throw new RefusMetier("Le formulaire est incomplet. Rechargez la page, puis recommencez.");
    }
    const photos = new Map<string, FichierRecu>();
    for (const [champ, valeur] of formulaire.entries()) {
      if (champ.startsWith("photo-") && valeur instanceof File) {
        photos.set(champ, {
          type: valeur.type,
          octets: new Uint8Array(await valeur.arrayBuffer()),
        });
      }
    }
    const id = formulaire.get("familleId");
    try {
      ({ familleId } = await enregistrerFamille(
        db,
        contexte,
        saisie,
        photos,
        stockage(),
        typeof id === "string" && id ? id : undefined,
      ));
    } catch (erreur) {
      if (erreur instanceof FamilleRefusee) throw new RefusMetier(erreur.message);
      throw erreur;
    }
  });
  return resultat.ok ? { ok: true, familleId } : resultat;
}

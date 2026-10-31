"use server";

import { revalidatePath } from "next/cache";
import { moniteursDeLEglise, prismaPourMoniteurs } from "@/server/plateforme/badges";
import { CarteImpossible, activerCarte, revoquerCarte } from "@/server/cartes/cycle";
import { detailCarte } from "@/server/cartes/lecture";
import { MESSAGES_SCAN, resoudreJeton, type ResolutionJeton } from "@/server/cartes/resolution";
import { RefusMetier, executerAction, executerActionAvec } from "../executer-action";

export type ResultatVerification = {
  statut: ResolutionJeton["statut"];
  message: string;
  carteId?: string;
  type?: "famille" | "enfant" | "badge";
  famille?: { id: string; nom: string; enfants: { prenom: string; matricule: string | null }[] };
  /** Name of the badge's monitor. */
  moniteur?: string;
};

/**
 * Verification scan (/cartes/verifier): strictly read-only. It never activates a pending
 * card (that would revoke the old one before the new one is handed over), never revokes,
 * never writes an audit entry.
 */
export async function verifierCarte(jeton: unknown) {
  return executerActionAvec(["checkin", "familles.gerer"], async ({ db, contexte }) => {
    const valeur = typeof jeton === "string" ? jeton.slice(0, 64) : "";
    const resolution = await resoudreJeton(db, valeur, prismaPourMoniteurs(contexte));
    const resultat: ResultatVerification = {
      statut: resolution.statut,
      message: resolution.statut === "active" ? "Carte valide." : MESSAGES_SCAN[resolution.statut],
    };
    if ("familleId" in resolution) {
      const famille = await detailCarte(db, resolution);
      resultat.carteId = resolution.carteId;
      resultat.type = resolution.type;
      if (famille) resultat.famille = famille;
    } else if ("membreId" in resolution) {
      resultat.type = "badge";
      resultat.message = "Badge moniteur valide.";
      const moniteur = (await moniteursDeLEglise(contexte)).find(
        (m) => m.membreId === resolution.membreId,
      );
      if (moniteur) resultat.moniteur = moniteur.nom;
    }
    return resultat;
  });
}

/** "Remettre la carte": the pending card is handed over; the old one is revoked. */
export async function remettreCarte(carteId: unknown, familleId?: unknown) {
  const resultat = await executerAction("familles.gerer", async ({ db, contexte }) => {
    if (typeof carteId !== "string") throw new RefusMetier("Carte introuvable.");
    try {
      await db.$tx((tx) => activerCarte(tx, contexte, carteId));
    } catch (erreur) {
      if (erreur instanceof CarteImpossible) {
        throw new RefusMetier("Cette carte n'est plus en attente. Rechargez la page.");
      }
      throw erreur;
    }
  });
  if (resultat.ok && typeof familleId === "string") revalidatePath(`/familles/${familleId}`);
  return resultat;
}

/** Revokes a card at once (lost card without reprint, card withdrawn). */
export async function retirerCarte(carteId: unknown, familleId?: unknown) {
  const resultat = await executerAction("familles.gerer", async ({ db, contexte }) => {
    if (typeof carteId !== "string") throw new RefusMetier("Carte introuvable.");
    try {
      await db.$tx((tx) => revoquerCarte(tx, contexte, carteId));
    } catch (erreur) {
      if (erreur instanceof CarteImpossible)
        throw new RefusMetier("Carte introuvable. Rechargez la page.");
      throw erreur;
    }
  });
  if (resultat.ok && typeof familleId === "string") revalidatePath(`/familles/${familleId}`);
  return resultat;
}

"use server";

import { revalidatePath } from "next/cache";
import {
  AccesPlateformeRefuse,
  creerEglise,
  suspendreOuReactiver,
} from "@/server/plateforme/console";
import { lienCompte } from "@/server/plateforme/comptes-eglise";
import { schemaNouvelleEglise } from "@/server/plateforme/eglises";

export type ResultatPlateforme = { ok: true } | { ok: false; erreur: string };
/** `lien`: activation link of a new first administrator, shown once; null for an existing account. */
export type ResultatCreationEglise =
  { ok: true; lien: string | null } | { ok: false; erreur: string };

const REFUSE = "Action réservée au super-administrateur. Reconnectez-vous.";

export async function creerNouvelleEglise(saisie: unknown): Promise<ResultatCreationEglise> {
  const donnees = schemaNouvelleEglise.safeParse(saisie);
  if (!donnees.success) {
    return { ok: false, erreur: donnees.error.issues[0]?.message ?? "Formulaire incomplet." };
  }
  try {
    const resultat = await creerEglise(donnees.data);
    if (resultat.statut === "slug_pris") {
      return {
        ok: false,
        erreur: "Cette adresse courte est déjà utilisée. Choisissez-en une autre.",
      };
    }
    revalidatePath("/plateforme");
    return { ok: true, lien: resultat.jeton ? lienCompte(resultat.jeton) : null };
  } catch (erreur) {
    if (erreur instanceof AccesPlateformeRefuse) return { ok: false, erreur: REFUSE };
    throw erreur;
  }
}

export async function changerStatut(
  egliseId: string,
  statut: "ACTIVE" | "SUSPENDUE",
): Promise<ResultatPlateforme> {
  if (statut !== "ACTIVE" && statut !== "SUSPENDUE") {
    return { ok: false, erreur: "Statut inconnu." };
  }
  try {
    const fait = await suspendreOuReactiver(String(egliseId), statut);
    revalidatePath("/plateforme");
    return fait ? { ok: true } : { ok: false, erreur: "Église introuvable." };
  } catch (erreur) {
    if (erreur instanceof AccesPlateformeRefuse) return { ok: false, erreur: REFUSE };
    throw erreur;
  }
}

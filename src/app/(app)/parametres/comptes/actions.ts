"use server";

import { z } from "zod";
import { modifierMembreEglise } from "@/server/plateforme/badges";
import { ROLES_COMPTE } from "@/lib/roles";
import { CompteRefuse } from "@/server/plateforme/comptes";
import {
  ajouterCompteEglise,
  lienActivationEglise,
  lienCompte,
  reinitialisationEglise,
} from "@/server/plateforme/comptes-eglise";
import { lireParametres } from "@/server/parametres";
import { RefusMetier, executerActionAvec } from "../../executer-action";

type Resultat<T> = { ok: true; donnees: T } | { ok: false; erreur: string };

const INTROUVABLE = "Compte introuvable. Rechargez la page.";

const metier = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (erreur) {
    if (erreur instanceof CompteRefuse) throw new RefusMetier(erreur.message);
    throw erreur;
  }
};

/**
 * Adds an account (cahier §7.10, ADR 0014). A new account comes with its activation link,
 * shown once; an existing account is attached, with a neutral answer.
 */
export async function ajouter(
  saisie: unknown,
): Promise<Resultat<{ statut: "cree"; lien: string } | { statut: "rattache" }>> {
  return executerActionAvec("comptes.gerer", async ({ db, contexte }) => {
    const indicatif = (await lireParametres(db))["telephone.indicatifParDefaut"];
    const resultat = await metier(() => ajouterCompteEglise(contexte, saisie, indicatif));
    return resultat.statut === "cree"
      ? { statut: "cree" as const, lien: lienCompte(resultat.jeton) }
      : { statut: "rattache" as const };
  });
}

/** New activation link of an account never activated; the previous link is revoked. */
export async function nouveauLien(membreId: string): Promise<Resultat<{ lien: string }>> {
  return executerActionAvec("comptes.gerer", async ({ contexte }) => {
    const resultat = await metier(() => lienActivationEglise(contexte, String(membreId)));
    if (!resultat) throw new RefusMetier(INTROUVABLE);
    return { lien: lienCompte(resultat.jeton) };
  });
}

/** Password reset, effective at once (password erased, sessions closed), with its link. */
export async function reinitialiser(membreId: string): Promise<Resultat<{ lien: string }>> {
  return executerActionAvec("comptes.gerer", async ({ contexte }) => {
    const resultat = await metier(() => reinitialisationEglise(contexte, String(membreId)));
    if (!resultat) throw new RefusMetier(INTROUVABLE);
    return { lien: lienCompte(resultat.jeton) };
  });
}

const schemaModification = z
  .object({
    roles: z.array(z.enum(ROLES_COMPTE)).min(1, "Choisissez au moins un rôle.").optional(),
    actif: z.boolean().optional(),
  })
  .strict();

/** Roles, deactivation or reactivation of a member (badge revoked when no longer a monitor). */
export async function modifier(membreId: string, saisie: unknown): Promise<Resultat<null>> {
  return executerActionAvec("comptes.gerer", async ({ contexte }) => {
    const changement = schemaModification.parse(saisie);
    const resultat = await metier(() =>
      modifierMembreEglise(contexte, String(membreId), changement),
    );
    if (!resultat) throw new RefusMetier(INTROUVABLE);
    return null;
  });
}

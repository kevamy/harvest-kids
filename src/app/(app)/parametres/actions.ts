"use server";

import { revalidatePath } from "next/cache";
import { creerClasse, modifierClasse } from "@/server/classes";
import { ecrireParametre } from "@/server/parametres";
import {
  LogoRefuse,
  ProfilRefuse,
  enregistrerLogo,
  enregistrerProfilEglise,
  type VarianteLogo,
} from "@/server/plateforme/profil-eglise";
import { RefusMetier, executerAction, type ResultatAction } from "../executer-action";

/**
 * Settings of the active church (cahier §7.10, RG-16, RG-17). Each action checks the
 * session, the church and the role itself (executerAction), validates with Zod in the
 * service, and writes the audit entry in the same transaction as the change.
 */

export async function enregistrerProfil(saisie: unknown): Promise<ResultatAction> {
  // No revalidatePath("/", "layout") here: application pages are dynamic (they read the
  // session) and the form calls router.refresh(). A layout-wide revalidation would also
  // invalidate the prerendered service worker (/serwist/sw.js), which Serwist cannot
  // rebuild in the standalone build. A new logo gets a new file key: no cache serves the
  // old one.
  return executerAction("eglise.parametrer", async ({ contexte }) => {
    try {
      await enregistrerProfilEglise(contexte, saisie);
    } catch (erreur) {
      if (erreur instanceof ProfilRefuse) throw new RefusMetier(erreur.message);
      throw erreur;
    }
  });
}

export async function enregistrerIndicatif(indicatif: unknown): Promise<ResultatAction> {
  const resultat = await executerAction("eglise.parametrer", async ({ db, contexte }) => {
    await db.$tx((tx) => ecrireParametre(tx, contexte, "telephone.indicatifParDefaut", indicatif));
  });
  if (resultat.ok) revalidatePath("/parametres/eglise");
  return resultat;
}

export async function televerserLogo(donnees: FormData): Promise<ResultatAction> {
  const variante: VarianteLogo = donnees.get("variante") === "clair" ? "clair" : "principal";
  const fichier = donnees.get("logo");
  const resultat = await executerAction("eglise.parametrer", async ({ contexte }) => {
    if (!(fichier instanceof File) || fichier.size === 0) {
      throw new RefusMetier("Choisissez un fichier PNG ou SVG.");
    }
    try {
      await enregistrerLogo(contexte, variante, {
        type: fichier.type,
        octets: new Uint8Array(await fichier.arrayBuffer()),
      });
    } catch (erreur) {
      if (erreur instanceof LogoRefuse) throw new RefusMetier(erreur.message);
      throw erreur;
    }
  });
  return resultat;
}

export async function supprimerLogoClair(): Promise<ResultatAction> {
  const resultat = await executerAction("eglise.parametrer", ({ contexte }) =>
    enregistrerLogo(contexte, "clair", null),
  );
  return resultat;
}

export async function enregistrerModeCarte(mode: unknown): Promise<ResultatAction> {
  const resultat = await executerAction("eglise.parametrer", async ({ db, contexte }) => {
    await db.$tx((tx) => ecrireParametre(tx, contexte, "cartes.mode", mode));
  });
  if (resultat.ok) revalidatePath("/parametres/cartes");
  return resultat;
}

export async function enregistrerImpression(saisie: unknown): Promise<ResultatAction> {
  const resultat = await executerAction("eglise.parametrer", async ({ db, contexte }) => {
    await db.$tx((tx) => ecrireParametre(tx, contexte, "impression", saisie));
  });
  if (resultat.ok) revalidatePath("/parametres/impression");
  return resultat;
}

export async function enregistrerDelaiPurge(jours: unknown): Promise<ResultatAction> {
  const resultat = await executerAction("eglise.parametrer", async ({ db, contexte }) => {
    await db.$tx((tx) =>
      ecrireParametre(tx, contexte, "familles.delaiPurgeBrouillonsJours", jours),
    );
  });
  if (resultat.ok) revalidatePath("/parametres/familles");
  return resultat;
}

export async function ajouterClasse(saisie: unknown): Promise<ResultatAction> {
  const resultat = await executerAction("classes.gerer", async ({ db, contexte }) => {
    await db.$tx((tx) => creerClasse(tx, contexte, saisie));
  });
  if (resultat.ok) revalidatePath("/parametres/classes");
  return resultat;
}

export async function mettreAJourClasse(
  classeId: unknown,
  saisie: unknown,
): Promise<ResultatAction> {
  const resultat = await executerAction("classes.gerer", async ({ db, contexte }) => {
    if (typeof classeId !== "string") throw new RefusMetier("Classe introuvable.");
    const trouvee = await db.$tx((tx) => modifierClasse(tx, contexte, classeId, saisie));
    // Same answer for a class of another church and a missing one.
    if (!trouvee) throw new RefusMetier("Classe introuvable. Rechargez la page.");
  });
  if (resultat.ok) revalidatePath("/parametres/classes");
  return resultat;
}

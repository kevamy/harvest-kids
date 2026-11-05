"use server";

import { ImportRefuse, TAILLE_MAX } from "@/server/import-familles/analyse";
import {
  analyserImport,
  importerFamilles,
  type ApercuImport,
  type RapportImport,
} from "@/server/import-familles/service";
import { RefusMetier, executerActionAvec } from "../../executer-action";

type Resultat<T> = { ok: true; donnees: T } | { ok: false; erreur: string };

/** The CSV file of the form, read in memory (never stored). */
async function lireFichier(formulaire: FormData): Promise<Uint8Array> {
  const fichier = formulaire.get("fichier");
  if (!(fichier instanceof File) || fichier.size === 0) {
    throw new RefusMetier("Choisissez un fichier CSV, puis recommencez.");
  }
  if (fichier.size > TAILLE_MAX) {
    throw new RefusMetier("Le fichier dépasse 1 Mo : découpez-le en plusieurs fichiers.");
  }
  return new Uint8Array(await fichier.arrayBuffer());
}

const metier = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (erreur) {
    if (erreur instanceof ImportRefuse) throw new RefusMetier(erreur.message);
    throw erreur;
  }
};

/** Preview of a family import (ADR 0013): reads the file, writes nothing. */
export async function analyser(formulaire: FormData): Promise<Resultat<ApercuImport>> {
  return executerActionAvec("familles.importer", async ({ db }) => {
    const octets = await lireFichier(formulaire);
    return metier(() => analyserImport(db, octets));
  });
}

/** Imports the families kept on the preview as drafts; the same file is sent again. */
export async function importer(formulaire: FormData): Promise<Resultat<RapportImport>> {
  return executerActionAvec("familles.importer", async ({ db, contexte }) => {
    const octets = await lireFichier(formulaire);
    let choix: unknown;
    try {
      choix = JSON.parse(String(formulaire.get("choix") ?? ""));
    } catch {
      throw new RefusMetier("Analysez le fichier avant de l'importer.");
    }
    return metier(() => importerFamilles(db, contexte, octets, choix));
  });
}

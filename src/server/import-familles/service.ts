import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { journaliser } from "@/lib/audit";
import type { ClientEglise } from "@/lib/tenant";
import { creerBrouillon } from "@/server/familles";
import { lireParametres } from "@/server/parametres";
import {
  ImportRefuse,
  analyserFichier,
  appliquerChoix,
  type AnalyseImport,
  type FamilleExistante,
  type Remarque,
} from "./analyse";

/**
 * Family import (cahier §7.1, ADR 0013): preview, then import as drafts. The file is never
 * stored: the browser sends it again with the choices, and the server analyses the same
 * bytes again (checked by their SHA-256 fingerprint) before writing anything. The audit
 * holds identifiers and counts only, never names or numbers.
 */

type Auteur = { userId: string; appareil: string | null };

export type ApercuImport = AnalyseImport & { empreinte: string };

export type RapportImport = {
  importees: { ref: string; nom: string; familleId: string; nonValides: number }[];
  ecartees: { ref: string; nom: string; raison: string }[];
  rejets: Remarque[];
};

export const schemaChoix = z.object({
  empreinte: z.string().regex(/^[0-9a-f]{64}$/, "Analysez le fichier avant de l'importer."),
  corrections: z.array(z.string().max(20)).max(4000),
  doublons: z.array(z.string().max(10)).max(2000),
});

const empreinteDe = (octets: Uint8Array) => createHash("sha256").update(octets).digest("hex");

/** Families of the active church (drafts included), for duplicate detection. */
async function famillesExistantes(db: ClientEglise): Promise<FamilleExistante[]> {
  const familles = await db.famille.findMany({
    select: {
      id: true,
      nom: true,
      finaliseeLe: true,
      enfants: { where: { actif: true }, select: { prenom: true } },
      tuteurs: { select: { telephone: true, telephone2: true } },
    },
  });
  return familles.map((f) => ({
    id: f.id,
    nom: f.nom,
    brouillon: f.finaliseeLe === null,
    prenomsEnfants: f.enfants.map((e) => e.prenom),
    telephones: f.tuteurs.flatMap((t) =>
      [t.telephone, t.telephone2].filter((n): n is string => Boolean(n)),
    ),
  }));
}

async function analyser(db: ClientEglise, octets: Uint8Array, maintenant: Date) {
  const [parametres, existantes] = await Promise.all([lireParametres(db), famillesExistantes(db)]);
  return analyserFichier(octets, {
    indicatif: parametres["telephone.indicatifParDefaut"],
    maintenant,
    existantes,
  });
}

/** Preview: reads only, writes nothing. */
export async function analyserImport(
  db: ClientEglise,
  octets: Uint8Array,
  maintenant = new Date(),
): Promise<ApercuImport> {
  return { ...(await analyser(db, octets, maintenant)), empreinte: empreinteDe(octets) };
}

/**
 * Imports the families kept on the preview as drafts, in one transaction: either every
 * draft is created, or none. Possible duplicates are only imported when ticked.
 */
export async function importerFamilles(
  db: ClientEglise,
  auteur: Auteur,
  octets: Uint8Array,
  choixBrut: unknown,
  maintenant = new Date(),
): Promise<RapportImport> {
  const choix = schemaChoix.parse(choixBrut);
  const empreinte = empreinteDe(octets);
  if (empreinte !== choix.empreinte) {
    throw new ImportRefuse(
      "Le fichier a changé depuis la prévisualisation. Analysez-le de nouveau, puis importez.",
    );
  }
  const analyse = await analyser(db, octets, maintenant);
  const { aCreer, ecartees } = appliquerChoix(analyse, choix);
  if (aCreer.length === 0) {
    throw new ImportRefuse(
      "Aucune famille à importer : toutes sont des doublons possibles non cochés ou des lignes rejetées.",
    );
  }
  const indicatif = (await lireParametres(db))["telephone.indicatifParDefaut"];

  const importees = await db.$tx(
    async (tx) => {
      const creees: RapportImport["importees"] = [];
      for (const brouillon of aCreer) {
        const famille = await creerBrouillon(tx, auteur, indicatif, brouillon);
        creees.push({
          ref: brouillon.ref,
          nom: brouillon.nom,
          familleId: famille.id,
          nonValides: brouillon.nonValides.length,
        });
      }
      await journaliser(tx, auteur, {
        action: "familles.importees",
        entite: "ImportFamilles",
        entiteId: empreinte,
        apres: {
          encodage: analyse.encodage,
          lignes: analyse.lignesLues,
          familles: creees.length,
          enfants: aCreer.reduce((n, b) => n + b.enfants.length, 0),
          ecartees: ecartees.length,
          rejets: analyse.rejets.length,
          numerosNonValides: aCreer.reduce((n, b) => n + b.nonValides.length, 0),
        },
      });
      return creees;
    },
    // Up to 2,000 lines: a few queries per family, in one transaction.
    { timeout: 120_000 },
  );

  return {
    importees,
    ecartees: ecartees.map((f) => ({
      ref: f.ref,
      nom: f.nom,
      raison: f.doublons[0]?.message ?? "Doublon possible.",
    })),
    rejets: analyse.rejets,
  };
}

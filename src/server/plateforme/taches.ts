import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { stockage as stockageApplication, type Stockage } from "@/lib/storage";
import { clientEglise } from "@/lib/tenant";
import { revoquerCartesPerimees } from "@/server/cartes/cycle";
import { purgerBrouillonsExpires } from "@/server/familles";
import { supprimerFichiersEchus } from "@/server/fichiers-differes";
import { lireParametres } from "@/server/parametres";
import { prismaPlateforme } from "./db";

export type BilanTaches = {
  eglises: number;
  brouillonsPurges: number;
  cartesRevoquees: number;
  fichiersSupprimes: number;
  erreurs: number;
};

/**
 * Daily task (ADR 0010): the periodic writes that must never happen while a page renders.
 * Church by church, through each church's scoped client: purge of expired drafts,
 * revocation of cards past a reissue deadline, deletion of replaced files after 24 h.
 * Idempotent: running it twice changes nothing more. One church failing does not stop
 * the others; only counts are reported, never personal data.
 */
export async function executerTachesQuotidiennes(
  base: PrismaClient,
  stockage: Stockage,
  maintenant = new Date(),
): Promise<BilanTaches> {
  const bilan: BilanTaches = {
    eglises: 0,
    brouillonsPurges: 0,
    cartesRevoquees: 0,
    fichiersSupprimes: 0,
    erreurs: 0,
  };
  const eglises = await base.eglise.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  for (const { id } of eglises) {
    try {
      const db = clientEglise(base, id);
      const parametres = await lireParametres(db);
      bilan.brouillonsPurges += await purgerBrouillonsExpires(
        db,
        parametres["familles.delaiPurgeBrouillonsJours"],
        maintenant,
      );
      bilan.cartesRevoquees += await revoquerCartesPerimees(db, maintenant);
      bilan.fichiersSupprimes += await supprimerFichiersEchus(db, id, stockage, maintenant);
      bilan.eglises++;
    } catch (erreur) {
      bilan.erreurs++;
      // Church id and error kind only: no personal data in the logs.
      console.error(`Tâche quotidienne en échec pour l'église ${id} : ${(erreur as Error).name}`);
    }
  }
  return bilan;
}

export function tachesQuotidiennes() {
  return executerTachesQuotidiennes(prismaPlateforme(), stockageApplication());
}

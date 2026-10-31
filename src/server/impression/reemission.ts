import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { journaliser } from "@/lib/audit";
import { ajouterJours, estJourValide, jourLocal, minuitLocal } from "@/lib/fuseau";
import type { ClientEglise } from "@/lib/tenant";
import { emettreCarte, revoquerEnAttenteHorsMode } from "@/server/cartes/cycle";
import { lireParametres } from "@/server/parametres";
import { ENFANTS_IMPRIMES, ImpressionRefusee, cartesAImprimer, sortieParDefaut } from "./cartes";
import { formatParId } from "./formats";
import { genererPdfCartes, type EgliseImpression } from "./pdf-carte";

/**
 * Bulk reissue (RG-16, cahier §7.10): after a mode change, a new logo or a new format,
 * every finalised family gets new pending cards in the current mode, linked to one
 * `ReemissionCartes` row. The cards in circulation stay valid: each new card replaces
 * them when it is handed over or first scanned, and, when a deadline is set, the old
 * cards are refused after it (read at scan time, revoked by the daily task).
 *
 * Same order as a single print: tokens drawn, PDF rendered in memory, then one
 * transaction issues the cards. Nothing is created when rendering fails.
 */

type Auteur = { userId: string; appareil: string | null };

/** The longest deadline accepted, in days after today. */
export const DELAI_MAX_JOURS = 365;
/** Bulk work: one transaction for every family, within the route's 60 s. */
const DUREE_TRANSACTION_MS = 45_000;

/**
 * The last day the old cards are accepted ("YYYY-MM-DD", church time zone) becomes the
 * instant they stop: local midnight at the end of that day. From tomorrow on: families
 * need time to receive their new cards.
 */
export function dateLimiteDepuisJour(jour: string, fuseau: string, maintenant = new Date()) {
  if (!estJourValide(jour)) throw new ImpressionRefusee("Choisissez une date limite valide.");
  const aujourdhui = jourLocal(maintenant, fuseau);
  if (jour <= aujourdhui) {
    throw new ImpressionRefusee(
      "Choisissez une date limite à partir de demain : les familles doivent recevoir leurs nouvelles cartes.",
    );
  }
  if (jour > ajouterJours(aujourdhui, DELAI_MAX_JOURS)) {
    throw new ImpressionRefusee("Choisissez une date limite dans l'année qui vient.");
  }
  return minuitLocal(ajouterJours(jour, 1), fuseau);
}

/** Families (finalised, with at least one printable child) and cards a reissue would issue. */
export async function apercuReemission(db: Pick<ClientEglise, "famille" | "parametre">) {
  const [{ "cartes.mode": mode }, familles] = await Promise.all([
    lireParametres(db),
    db.famille.findMany({
      where: { finaliseeLe: { not: null }, enfants: { some: ENFANTS_IMPRIMES.where } },
      select: { _count: { select: { enfants: { where: ENFANTS_IMPRIMES.where } } } },
    }),
  ]);
  return {
    mode,
    familles: familles.length,
    cartes:
      mode === "FAMILLE" ? familles.length : familles.reduce((n, f) => n + f._count.enfants, 0),
  };
}

export async function reemettreCartes(
  db: ClientEglise,
  auteur: Auteur,
  eglise: EgliseImpression,
  options: { dateLimite: Date | null },
): Promise<{ pdf: Buffer; reemissionId: string; familles: number; cartes: number }> {
  const parametres = await lireParametres(db);
  const mode = parametres["cartes.mode"];
  const familles = await db.famille.findMany({
    where: { finaliseeLe: { not: null } },
    // Sheets in alphabetical order: the reception hands them out family by family.
    orderBy: [{ nom: "asc" }, { id: "asc" }],
    select: { id: true, nom: true, enfants: ENFANTS_IMPRIMES },
  });
  const aImprimer = familles
    .filter((f) => f.enfants.length > 0)
    .map((f) => ({ familleId: f.id, cartes: cartesAImprimer(f, mode) }));
  if (aImprimer.length === 0) {
    throw new ImpressionRefusee("Aucune famille inscrite : il n'y a aucune carte à réémettre.");
  }
  const toutes = aImprimer.flatMap((f) => f.cartes);

  const format = parametres.impression.format;
  const pdf = await genererPdfCartes(
    toutes.map((c) => c.contenu),
    { ...eglise, textes: parametres["cartes.textes"] },
    {
      format: formatParId(format),
      rectoVerso: parametres.impression.rectoVerso,
      sortie: sortieParDefaut(format),
    },
  );

  const reemissionId = await db.$tx(
    async (tx) => {
      const reemission = await tx.reemissionCartes.create({
        data: {
          mode,
          dateLimite: options.dateLimite,
          creePar: auteur.userId,
        } as Prisma.ReemissionCartesUncheckedCreateInput, // egliseId: scoped client
        select: { id: true },
      });
      for (const famille of aImprimer) {
        await revoquerEnAttenteHorsMode(tx, auteur, famille.familleId, mode);
        for (const { couverture, contenu } of famille.cartes) {
          await emettreCarte(tx, auteur, couverture, {
            reemissionId: reemission.id,
            jeton: contenu.jeton,
          });
        }
      }
      // No personal data: counts only.
      await journaliser(tx, auteur, {
        action: "reemission.creee",
        entite: "ReemissionCartes",
        entiteId: reemission.id,
        apres: {
          mode,
          format,
          dateLimite: options.dateLimite?.toISOString() ?? null,
          familles: aImprimer.length,
          cartes: toutes.length,
        },
      });
      return reemission.id;
    },
    { timeout: DUREE_TRANSACTION_MS },
  );

  return { pdf, reemissionId, familles: aImprimer.length, cartes: toutes.length };
}

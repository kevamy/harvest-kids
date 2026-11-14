import { randomInt } from "node:crypto";

/**
 * Pure check-in rules (cahier §7.3, RG-04, RG-17), tested without a database.
 */

/** Session retrieval code alphabet: no 0, O, 1, I or L, which are read or heard wrongly. */
export const ALPHABET_CODE_RETRAIT = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const FORMAT_CODE_RETRAIT = /^[2-9A-HJKMNP-Z]{4}$/;

/** A 4-character retrieval code (RG-04), from a cryptographic random source. */
export function genererCodeRetrait(aleatoire: (max: number) => number = randomInt): string {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += ALPHABET_CODE_RETRAIT[aleatoire(ALPHABET_CODE_RETRAIT.length)];
  }
  return code;
}

/**
 * Age in completed months on the session's date (RG-17). Both are calendar dates (stored as
 * dates, read at UTC midnight): the session's date is already the church's local day.
 */
export function ageEnMoisRevolus(naissance: Date, jourSession: Date): number {
  const mois =
    (jourSession.getUTCFullYear() - naissance.getUTCFullYear()) * 12 +
    (jourSession.getUTCMonth() - naissance.getUTCMonth());
  return jourSession.getUTCDate() < naissance.getUTCDate() ? mois - 1 : mois;
}

export type ClasseCandidate = {
  id: string;
  nom: string;
  ageMinMois: number;
  ageMaxMois: number;
  ordre: number;
  active: boolean;
};

export type ClasseProposee = {
  /** The class offered first, or null: no range covers the child, choose by hand. */
  proposee: string | null;
  /** Other active classes covering the age, in class order (secondary choices). */
  autres: string[];
  raison: "forcee" | "age" | "aucune";
};

/**
 * RG-17: the child's forced class when it is active; otherwise, among the active classes
 * whose range covers the age (bounds included), the first in class order, the others as
 * secondary choices.
 */
export function classeProposee(
  enfant: { classeForceeId: string | null; ageMois: number },
  classes: readonly ClasseCandidate[],
): ClasseProposee {
  const actives = classes.filter((c) => c.active);
  const couvrantes = actives
    .filter((c) => c.ageMinMois <= enfant.ageMois && enfant.ageMois <= c.ageMaxMois)
    .sort((x, y) => x.ordre - y.ordre || x.nom.localeCompare(y.nom, "fr"));
  const forcee = actives.find((c) => c.id === enfant.classeForceeId);
  if (forcee) {
    return {
      proposee: forcee.id,
      autres: couvrantes.filter((c) => c.id !== forcee.id).map((c) => c.id),
      raison: "forcee",
    };
  }
  if (couvrantes.length === 0) return { proposee: null, autres: [], raison: "aucune" };
  return {
    proposee: couvrantes[0]!.id,
    autres: couvrantes.slice(1).map((c) => c.id),
    raison: "age",
  };
}

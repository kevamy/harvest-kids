/**
 * Child status as displayed. ATTENDU is computed (registered child without a
 * presence in the session); APPEL is the parent-call flag shown as a status.
 * One colour per status, always shown with its label (design/composant-StatusPill.md).
 */
export const STATUTS_AFFICHES = [
  "ATTENDU",
  "PRESENT",
  "EN_SALLE",
  "APPEL",
  "INFIRMERIE",
  "RECUPERE",
] as const;

export type StatutAffiche = (typeof STATUTS_AFFICHES)[number];

type Apparence = { libelle: string; classes: string };

export const APPARENCE_STATUT: Record<StatutAffiche, Apparence> = {
  ATTENDU: {
    libelle: "Attendu",
    classes: "bg-blanc text-texte-doux ring-[1.5px] ring-inset ring-ligne",
  },
  PRESENT: { libelle: "Présent", classes: "bg-bleu-voile text-nuit" },
  EN_SALLE: { libelle: "En salle", classes: "bg-bleu-layette text-nuit" },
  APPEL: { libelle: "Parent appelé", classes: "bg-soleil text-nuit" },
  INFIRMERIE: { libelle: "Infirmerie", classes: "bg-alerte text-blanc" },
  RECUPERE: { libelle: "Récupéré", classes: "bg-succes text-blanc" },
};

/** RG-07: a child at the infirmary is listed first on every screen showing them. */
export function trierInfirmerieEnTete<T extends { statut: StatutAffiche }>(
  liste: readonly T[],
): T[] {
  return [...liste].sort(
    (a, b) => Number(b.statut === "INFIRMERIE") - Number(a.statut === "INFIRMERIE"),
  );
}

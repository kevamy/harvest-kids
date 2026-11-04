/**
 * Card and badge print formats (cahier §7.10): five sizes in three families. Each
 * church prints its own cards; it picks a default format, changeable at print time.
 * Pure data, shared by the settings page, the previews and the PDF output.
 */
export const IDS_FORMAT = ["CR80", "90x54", "90x50", "70x100", "85x100"] as const;
export type IdFormat = (typeof IDS_FORMAT)[number];

export type FormatCarte = {
  id: IdFormat;
  libelle: string;
  famille: "pvc" | "imprimerie" | "grand-format";
  largeurMm: number;
  hauteurMm: number;
  orientation: "paysage" | "portrait";
  usage: string;
};

export const FORMATS: readonly FormatCarte[] = [
  {
    id: "CR80",
    libelle: "Carte PVC CR80",
    famille: "pvc",
    largeurMm: 85.6,
    hauteurMm: 53.98,
    orientation: "paysage",
    usage: "Imprimante à cartes PVC",
  },
  {
    id: "90x54",
    libelle: "Carte 90 × 54 mm",
    famille: "imprimerie",
    largeurMm: 90,
    hauteurMm: 54,
    orientation: "paysage",
    usage: "Imprimeur, papier semi-rigide",
  },
  {
    id: "90x50",
    libelle: "Carte 90 × 50 mm",
    famille: "imprimerie",
    largeurMm: 90,
    hauteurMm: 50,
    orientation: "paysage",
    usage: "Imprimeur, papier semi-rigide",
  },
  {
    id: "70x100",
    libelle: "Badge 70 × 100 mm",
    famille: "grand-format",
    largeurMm: 70,
    hauteurMm: 100,
    orientation: "portrait",
    usage: "Événement avec cordon, lisible à distance",
  },
  {
    id: "85x100",
    libelle: "Badge 85 × 100 mm",
    famille: "grand-format",
    largeurMm: 85,
    hauteurMm: 100,
    orientation: "portrait",
    usage: "Événement avec cordon, lisible à distance",
  },
];

export function formatParId(id: IdFormat): FormatCarte {
  const format = FORMATS.find((f) => f.id === id);
  if (!format) throw new Error(`Format inconnu : ${id}`);
  return format;
}

/** "85,6 × 53,98 mm", French decimal comma. */
export function dimensionsLisibles(format: FormatCarte): string {
  const mm = (valeur: number) => String(valeur).replace(".", ",");
  return `${mm(format.largeurMm)} × ${mm(format.hauteurMm)} mm`;
}

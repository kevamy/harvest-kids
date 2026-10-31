import type { FormatCarte } from "./formats";

/**
 * Print geometry (cahier §7.10), pure and shared by the PDF and the previews. Every
 * length is in millimetres; the PDF converts to points (1 pt = 1/72 in).
 */
export const MM_EN_POINTS = 72 / 25.4;
export const enPoints = (mm: number) => Math.round(mm * MM_EN_POINTS * 100) / 100;

export const A4 = { largeurMm: 210, hauteurMm: 297 } as const;
/** Bleed around each card of an A4 sheet: colours run 3 mm past the trim line. */
export const FOND_PERDU_MM = 3;
/** Page margin of an A4 sheet: crop marks are drawn there, outside the bleed. */
export const MARGE_PLANCHE_MM = 8;
/** Crop marks: start 1 mm past the bleed, 4 mm long. */
export const TRAIT_COUPE = { ecartMm: 1, longueurMm: 4 } as const;

export type Planche = {
  colonnes: number;
  lignes: number;
  parPage: number;
  /** Top-left corner of each card's trim box on the page, row by row. */
  positions: { xMm: number; yMm: number }[];
};

/**
 * Cards per A4 sheet for a format: as many as fit with their bleed inside the page
 * margins, the grid centred on the page. Cells touch: neighbouring bleeds overlap the
 * gutter, which is cut away.
 */
export function disposerPlanche(format: Pick<FormatCarte, "largeurMm" | "hauteurMm">): Planche {
  const cellule = {
    largeur: format.largeurMm + 2 * FOND_PERDU_MM,
    hauteur: format.hauteurMm + 2 * FOND_PERDU_MM,
  };
  const colonnes = Math.floor((A4.largeurMm - 2 * MARGE_PLANCHE_MM) / cellule.largeur);
  const lignes = Math.floor((A4.hauteurMm - 2 * MARGE_PLANCHE_MM) / cellule.hauteur);
  const origine = {
    x: (A4.largeurMm - colonnes * cellule.largeur) / 2 + FOND_PERDU_MM,
    y: (A4.hauteurMm - lignes * cellule.hauteur) / 2 + FOND_PERDU_MM,
  };
  const positions = [];
  for (let ligne = 0; ligne < lignes; ligne++) {
    for (let colonne = 0; colonne < colonnes; colonne++) {
      positions.push({
        xMm: origine.x + colonne * cellule.largeur,
        yMm: origine.y + ligne * cellule.hauteur,
      });
    }
  }
  return { colonnes, lignes, parPage: colonnes * lignes, positions };
}

/**
 * Back of a two-sided sheet, printed long-edge: columns are mirrored so that each back
 * lands behind its front.
 */
export function positionsVerso(planche: Planche): { xMm: number; yMm: number }[] {
  return planche.positions.map((_, i) => {
    const ligne = Math.floor(i / planche.colonnes);
    const colonne = i % planche.colonnes;
    return planche.positions[ligne * planche.colonnes + (planche.colonnes - 1 - colonne)]!;
  });
}

export type Zone = { x: number; y: number; largeur: number; hauteur: number };

export type Gabarit = {
  largeurMm: number;
  hauteurMm: number;
  /** 3 mm safety zone: no important text outside it. */
  securite: Zone;
  /** Strip reserved for the lanyard hole (portrait formats), left empty. */
  perforation: Zone | null;
  /** Header strip: church logo and name. */
  bandeau: Zone;
  /** QR code symbol (quiet zone included), at least 20 mm of modules. */
  qr: Zone;
  /** Family name, children and matricules. */
  texte: Zone;
  /** Front only: reception phone and a short instruction. */
  pied: Zone | null;
  /** Matricule font size, in points. */
  corpsMatricule: number;
};

export const SECURITE_MM = 3;
export const QR_MIN_MM = 20;

/**
 * Card layout by format. Landscape: header strip on top, text on the left, QR code on
 * the right. Portrait (event badges): free strip on top for the lanyard hole, larger QR
 * code and matricules, readable from a distance.
 */
export function calculerGabarit(
  format: Pick<FormatCarte, "largeurMm" | "hauteurMm" | "orientation">,
  rectoSeul: boolean,
): Gabarit {
  const { largeurMm: L, hauteurMm: H } = format;
  const s = SECURITE_MM;
  const securite = { x: s, y: s, largeur: L - 2 * s, hauteur: H - 2 * s };
  const hauteurPied = rectoSeul ? (format.orientation === "portrait" ? 10 : 7) : 0;

  if (format.orientation === "portrait") {
    const perforation = { x: 0, y: 0, largeur: L, hauteur: 12 };
    const bandeau = { x: s, y: perforation.hauteur, largeur: L - 2 * s, hauteur: 16 };
    const cote = Math.max(QR_MIN_MM + 12, Math.min(L - 2 * s - 16, 44));
    const qr = {
      x: (L - cote) / 2,
      y: bandeau.y + bandeau.hauteur + 3,
      largeur: cote,
      hauteur: cote,
    };
    const hautTexte = qr.y + cote + 2;
    const pied = hauteurPied
      ? { x: s, y: H - s - hauteurPied, largeur: L - 2 * s, hauteur: hauteurPied }
      : null;
    const texte = {
      x: s,
      y: hautTexte,
      largeur: L - 2 * s,
      hauteur: (pied ? pied.y : H - s) - hautTexte,
    };
    return {
      largeurMm: L,
      hauteurMm: H,
      securite,
      perforation,
      bandeau,
      qr,
      texte,
      pied,
      corpsMatricule: 15,
    };
  }

  const bandeau = { x: 0, y: 0, largeur: L, hauteur: 12 };
  const pied = hauteurPied
    ? { x: s, y: H - s - hauteurPied, largeur: L - 2 * s, hauteur: hauteurPied }
    : null;
  const bas = pied ? pied.y : H - s;
  // Quiet zone included: 4 modules on each side of a 29-module symbol (37 in all), so
  // 26 mm of square give a 20.4 mm symbol. A unit test checks every format.
  const cote = Math.min(28, bas - bandeau.hauteur - 1);
  const qr = { x: L - s - cote, y: bandeau.hauteur + 1, largeur: cote, hauteur: cote };
  const texte = {
    x: s,
    y: bandeau.hauteur + 2,
    largeur: qr.x - s - 2,
    hauteur: bas - bandeau.hauteur - 2,
  };
  return {
    largeurMm: L,
    hauteurMm: H,
    securite,
    perforation: null,
    bandeau,
    qr,
    texte,
    pied,
    corpsMatricule: 10,
  };
}

import { formaterTelephone } from "@/lib/telephone";

/**
 * Card texts set by each church (Paramètres › Impression): the front footer (reception
 * phone and a short instruction, front-only printing) and the back instructions. Lengths
 * are capped so that the text fits every one of the five formats; a unit test renders the
 * longest allowed text in each format and checks that no line leaves its zone.
 */
export const LIMITES_TEXTES_CARTE = {
  consigneCourte: 60,
  titreVerso: 40,
  consigneVerso: 90,
  nombreConsignesVerso: 3,
} as const;

export type TextesCarte = {
  /** Shows the reception phone (church profile) in the front footer. */
  afficherTelephone: boolean;
  consigneCourte: string;
  titreVerso: string;
  consignesVerso: string[];
};

export const TEXTES_CARTE_PAR_DEFAUT: TextesCarte = {
  afficherTelephone: true,
  consigneCourte: "Présentez cette carte à chaque dépôt et à chaque retrait.",
  titreVerso: "Dépôt et retrait des enfants",
  consignesVerso: [
    "Présentez cette carte à chaque dépôt et à chaque retrait.",
    "Seules les personnes autorisées par la famille peuvent récupérer les enfants.",
    "Carte perdue ou abîmée : signalez-le à l'accueil enfants.",
  ],
};

/**
 * Type sizes (points) and line height of the card texts, shared by the PDF, the previews
 * and the fit check (mesure.ts): the check measures exactly what is printed.
 */
export const TYPO = {
  interligne: 1.2,
  pied: { paysage: 6, portrait: 7.5 },
  verso: {
    titre: 9,
    consigne: 7,
    telephone: 8,
    nom: 6.5,
    /** Space below the title, between instructions and above the name, in points. */
    ecart: 2,
  },
  /**
   * Monitor badge, front: the "Badge moniteur" mention and the monitor's name, set at its
   * base size or lowered down to `nomMin` to fit (mesure.ts, corpsNomBadge).
   */
  badge: {
    mention: { paysage: 7, portrait: 8 },
    nom: { paysage: 10, portrait: 12 },
    nomMin: 7,
  },
} as const;

/**
 * Monitor badges (cahier §7.10): fixed texts, through the same footer and back as the cards.
 * Checked in the five formats by the same unit test as the card texts.
 */
export const TEXTES_BADGE: TextesCarte = {
  afficherTelephone: false,
  consigneCourte: "Badge personnel : scannez-le à votre arrivée.",
  titreVerso: "Badge moniteur",
  consignesVerso: [
    "Scannez ce badge à votre arrivée pour enregistrer votre présence.",
    "Badge personnel : ne le prêtez pas.",
    "Badge perdu : signalez-le à un administrateur.",
  ],
};

/** Longest monitor name printed on a badge; beyond, it is shortened with "…". */
export const NOM_BADGE_MAX = 40;

export function nomBadge(nom: string): string {
  const propre = nom.trim().replace(/\s+/g, " ");
  return propre.length <= NOM_BADGE_MAX
    ? propre
    : `${propre.slice(0, NOM_BADGE_MAX - 1).trimEnd()}…`;
}

/** Reception phone line, or null when hidden or not set in the church profile. */
export function ligneTelephone(textes: TextesCarte, telephoneAccueil: string | null) {
  return textes.afficherTelephone && telephoneAccueil
    ? `Accueil enfants : ${formaterTelephone(telephoneAccueil)}`
    : null;
}

/** Front footer (front-only printing): reception phone, if shown, then the short instruction. */
export function textePied(textes: TextesCarte, telephoneAccueil: string | null): string {
  const telephone = ligneTelephone(textes, telephoneAccueil);
  return telephone ? `${telephone} · ${textes.consigneCourte}` : textes.consigneCourte;
}

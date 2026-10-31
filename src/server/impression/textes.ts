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
} as const;

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

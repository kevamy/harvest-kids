import "server-only";
import sharp from "sharp";

/**
 * Fictitious images for the demonstration seed, drawn with shapes only (no text,
 * so no font is needed on the server). Never a real logo or a real photo.
 */
const NUIT = "#1f2557";
const BLEU = "#2369c4";
const SOLEIL = "#ffd45c";
const BLANC = "#ffffff";

function pngDepuisSvg(svg: string, taille: number): Promise<Buffer> {
  return sharp(Buffer.from(svg)).resize(taille, taille).png().toBuffer();
}

/** Fictitious church logo: a chapel with a sunrise. `clair` = variant for dark backgrounds. */
export function logoEgliseFictif(clair = false): Promise<Buffer> {
  const trait = clair ? BLANC : NUIT;
  const toit = clair ? SOLEIL : BLEU;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <circle cx="100" cy="120" r="70" fill="${SOLEIL}" opacity="${clair ? 0.35 : 0.6}"/>
    <path d="M45 115 L100 62 L155 115 Z" fill="${toit}"/>
    <rect x="58" y="112" width="84" height="62" rx="6" fill="${trait}"/>
    <rect x="88" y="136" width="24" height="38" rx="12" fill="${clair ? NUIT : SOLEIL}"/>
    <rect x="96" y="22" width="8" height="40" rx="3" fill="${trait}"/>
    <rect x="84" y="32" width="32" height="8" rx="3" fill="${trait}"/>
  </svg>`;
  return pngDepuisSvg(svg, 256);
}

/** Neutral silhouette standing in for an authorised adult's photo. */
export function silhouetteFictive(index: number): Promise<Buffer> {
  // Alternating colours, never tied to the person's sex (design/charte.md).
  const fond = index % 2 === 0 ? "#8cc8f5" : "#f58ab6";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
    <rect width="120" height="120" fill="${fond}"/>
    <circle cx="60" cy="46" r="22" fill="${NUIT}" opacity="0.85"/>
    <path d="M18 120 C18 88 38 74 60 74 C82 74 102 88 102 120 Z" fill="${NUIT}" opacity="0.85"/>
  </svg>`;
  return pngDepuisSvg(svg, 240);
}

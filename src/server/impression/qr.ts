import QRCode from "qrcode";

/** Quiet zone around the symbol, in modules (ISO/IEC 18004 asks for 4). */
export const ZONE_SILENCE_MODULES = 4;

export type MatriceQr = {
  /** Modules per side of the symbol. */
  taille: number;
  /** Modules per side, quiet zone included. */
  total: number;
  /** Dark runs, row by row, in modules from the top-left corner of the quiet zone. */
  segments: { x: number; y: number; longueur: number }[];
};

/**
 * QR code of a card token as vector runs: crisp at any print size, and the same matrix
 * for the PDF and the on-screen previews. Error correction M.
 */
export function matriceQr(texte: string): MatriceQr {
  const { modules } = QRCode.create(texte, { errorCorrectionLevel: "M" });
  const taille = modules.size;
  const segments: MatriceQr["segments"] = [];
  for (let y = 0; y < taille; y++) {
    let debut = -1;
    for (let x = 0; x <= taille; x++) {
      const sombre = x < taille && modules.get(y, x) === 1;
      if (sombre && debut < 0) debut = x;
      if (!sombre && debut >= 0) {
        segments.push({
          x: debut + ZONE_SILENCE_MODULES,
          y: y + ZONE_SILENCE_MODULES,
          longueur: x - debut,
        });
        debut = -1;
      }
    }
  }
  return { taille, total: taille + 2 * ZONE_SILENCE_MODULES, segments };
}

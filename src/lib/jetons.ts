import { randomBytes } from "node:crypto";

/**
 * RG-02: the family card's QR code holds an opaque random token, `HKF1.` followed
 * by 22 base62 characters (~131 bits), never a matricule nor a name.
 */
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const FORMAT_JETON_CARTE = /^HKF1\.[0-9A-Za-z]{22}$/;

export function genererJetonCarte(): string {
  let jeton = "";
  // Rejection sampling: bytes >= 248 are dropped to keep the 62 symbols equiprobable.
  while (jeton.length < 22) {
    for (const octet of randomBytes(32)) {
      if (octet < 248 && jeton.length < 22) jeton += BASE62[octet % 62];
    }
  }
  return `HKF1.${jeton}`;
}

export function estJetonCarte(valeur: string): boolean {
  return FORMAT_JETON_CARTE.test(valeur);
}

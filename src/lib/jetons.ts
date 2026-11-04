import { createHash, randomBytes } from "node:crypto";

/**
 * RG-02: a card's QR code holds an opaque random token, a prefix followed by 22 base62
 * characters (~131 bits), never a matricule nor a name. `HKF1.` for family and child
 * cards, `HKB1.` for monitor badges, so a scan knows the kind without a query.
 *
 * The database only stores the SHA-256 fingerprint of a token (ADR 0008): a leaked
 * database cannot produce a valid card. The clear token only exists in the printed PDF.
 */
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const FORMAT_JETON_CARTE = /^HKF1\.[0-9A-Za-z]{22}$/;
export const FORMAT_JETON_BADGE = /^HKB1\.[0-9A-Za-z]{22}$/;

function aleatoireBase62(longueur: number): string {
  let resultat = "";
  // Rejection sampling: bytes >= 248 are dropped to keep the 62 symbols equiprobable.
  while (resultat.length < longueur) {
    for (const octet of randomBytes(32)) {
      if (octet < 248 && resultat.length < longueur) resultat += BASE62[octet % 62];
    }
  }
  return resultat;
}

export function genererJetonCarte(): string {
  return `HKF1.${aleatoireBase62(22)}`;
}

export function genererJetonBadge(): string {
  return `HKB1.${aleatoireBase62(22)}`;
}

export function estJetonCarte(valeur: string): boolean {
  return FORMAT_JETON_CARTE.test(valeur);
}

export function estJetonBadge(valeur: string): boolean {
  return FORMAT_JETON_BADGE.test(valeur);
}

/** Kind of a scanned value, from its format alone (no database access). */
export function typeJeton(valeur: string): "carte" | "badge" | null {
  if (estJetonCarte(valeur)) return "carte";
  if (estJetonBadge(valeur)) return "badge";
  return null;
}

/** SHA-256 fingerprint stored in the database, lowercase hexadecimal (64 characters). */
export function empreinteJeton(jeton: string): string {
  return createHash("sha256").update(jeton, "utf8").digest("hex");
}

export const FORMAT_EMPREINTE = /^[0-9a-f]{64}$/;

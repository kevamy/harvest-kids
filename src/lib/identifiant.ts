/**
 * Sign-in identifier: an e-mail address or a phone number (cahier §10).
 * Phone numbers are normalised to E.164; a local Beninese number (8 or 10 digits)
 * gets the +229 prefix.
 */
export type Identifiant = { type: "email"; valeur: string } | { type: "telephone"; valeur: string };

export function normaliserTelephone(saisie: string): string | null {
  const compact = saisie.replace(/[\s.\-()]/g, "");
  if (/^\+\d{8,15}$/.test(compact)) return compact;
  if (/^00\d{8,15}$/.test(compact)) return `+${compact.slice(2)}`;
  // Benin: 10-digit numbers since 2024 (01 XX XX XX XX), 8 digits before.
  if (/^\d{8}$/.test(compact) || /^01\d{8}$/.test(compact)) return `+229${compact}`;
  return null;
}

export function analyserIdentifiant(saisie: string): Identifiant | null {
  const texte = saisie.trim();
  if (texte.includes("@")) {
    const email = texte.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { type: "email", valeur: email } : null;
  }
  const telephone = normaliserTelephone(texte);
  return telephone ? { type: "telephone", valeur: telephone } : null;
}

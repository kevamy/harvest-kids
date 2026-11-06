import { INDICATIF_PAR_DEFAUT, normaliserTelephone } from "@/lib/telephone";

/**
 * Sign-in identifier: an e-mail address or a phone number (cahier §10).
 * Phone numbers follow the same normalisation as everywhere else (E.164, ADR 0011), with
 * the Beninese country code by default: accounts are stored that way. A Beninese number
 * in the former 8-digit plan is tried with the "01" prefix (the account cannot hold the
 * 8-digit form). If that fails too, the sign-in answers with the same generic message: it
 * never reveals whether an account exists.
 */
export type Identifiant = { type: "email"; valeur: string } | { type: "telephone"; valeur: string };

export function analyserIdentifiant(saisie: string): Identifiant | null {
  const texte = saisie.trim();
  if (texte.includes("@")) {
    const email = texte.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { type: "email", valeur: email } : null;
  }
  const telephone = normaliserTelephone(texte, INDICATIF_PAR_DEFAUT);
  // "a_confirmer": the former 8-digit plan, tried with its "01" prefix.
  return telephone.statut === "invalide" ? null : { type: "telephone", valeur: telephone.e164 };
}

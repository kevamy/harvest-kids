/**
 * Personal 6-digit PIN used to unlock a shared tablet (cahier §9).
 * After MAX_ECHECS wrong attempts the PIN is blocked for DUREE_BLOCAGE_MS and the
 * person must sign in again with their password.
 */
export const MAX_ECHECS_PIN = 5;
export const DUREE_BLOCAGE_PIN_MS = 15 * 60 * 1000;

export type EtatPin = { pinEchecs: number; pinBloqueJusqua: Date | null };

export function formatPinValide(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return false;
  if (/^(\d)\1{5}$/.test(pin)) return false; // 000000, 111111…
  const montant = "0123456789012345";
  const descendant = "9876543210987654";
  return !montant.includes(pin) && !descendant.includes(pin); // 123456, 654321…
}

export function pinBloque(etat: EtatPin, maintenant: Date): boolean {
  return etat.pinBloqueJusqua !== null && etat.pinBloqueJusqua.getTime() > maintenant.getTime();
}

/** State after a wrong attempt. */
export function apresEchecPin(etat: EtatPin, maintenant: Date): EtatPin {
  const pinEchecs = etat.pinEchecs + 1;
  return pinEchecs >= MAX_ECHECS_PIN
    ? { pinEchecs, pinBloqueJusqua: new Date(maintenant.getTime() + DUREE_BLOCAGE_PIN_MS) }
    : { pinEchecs, pinBloqueJusqua: etat.pinBloqueJusqua };
}

export const ETAT_PIN_INITIAL: EtatPin = { pinEchecs: 0, pinBloqueJusqua: null };

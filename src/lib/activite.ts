/**
 * Shared-tablet lock (cahier §9): after 15 minutes without user activity the
 * session is locked and must be unlocked with the personal PIN.
 *
 * Activity is recorded at most once per minute, and automatic refreshes of live
 * screens (useLiveQuery) never count as activity: otherwise a tablet left on a
 * live screen would never lock.
 */
export const DELAI_VERROUILLAGE_MS = 15 * 60 * 1000;
export const INTERVALLE_ENREGISTREMENT_MS = 60 * 1000;

/** Header sent by useLiveQuery on automatic refreshes. */
export const ENTETE_RAFRAICHISSEMENT_AUTO = "x-hk-rafraichissement";

export function estVerrouillee(derniereActivite: Date | null, maintenant: Date): boolean {
  // A session without any recorded activity is treated as just opened.
  if (!derniereActivite) return false;
  return maintenant.getTime() - derniereActivite.getTime() >= DELAI_VERROUILLAGE_MS;
}

export function doitEnregistrerActivite(derniereActivite: Date | null, maintenant: Date): boolean {
  if (!derniereActivite) return true;
  return maintenant.getTime() - derniereActivite.getTime() >= INTERVALLE_ENREGISTREMENT_MS;
}

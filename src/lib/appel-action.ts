/**
 * Calls a Server Action from the browser. A network failure (or a server error) is
 * reported with an explicit message: nothing unsaved is ever shown as a success.
 */
export const RESEAU_INDISPONIBLE =
  "Le serveur ne répond pas. Vérifiez la connexion, puis réessayez.";

export async function appelerAction<R extends { ok: boolean }>(
  action: () => Promise<R>,
): Promise<R | { ok: false; erreur: string }> {
  try {
    return await action();
  } catch {
    return { ok: false, erreur: RESEAU_INDISPONIBLE };
  }
}

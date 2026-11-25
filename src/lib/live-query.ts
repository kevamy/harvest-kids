"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ENTETE_RAFRAICHISSEMENT_AUTO } from "@/lib/activite";

/** Live screens refresh every 3 to 5 seconds (cahier §9). */
export const INTERVALLE_DIRECT_MS = 4000;
/**
 * Screens that must show an infirmerie child within 5 seconds (lot 3: infirmerie, alerts,
 * call screen): margin for the request and the rendering.
 */
export const INTERVALLE_URGENT_MS = 3000;

export class ErreurDirect extends Error {
  constructor(readonly statut: number) {
    super(statut === 0 ? "Hors connexion" : `Erreur ${statut}`);
    this.name = "ErreurDirect";
  }
}

/**
 * Fetches a live endpoint. The header tells the server this is an automatic
 * refresh: it must not count as user activity (the tablet still locks).
 */
export async function chargerDirect<T>(url: string, signal?: AbortSignal): Promise<T> {
  let reponse: Response;
  try {
    reponse = await fetch(url, {
      headers: { [ENTETE_RAFRAICHISSEMENT_AUTO]: "1" },
      cache: "no-store",
      signal,
    });
  } catch {
    throw new ErreurDirect(0);
  }
  if (!reponse.ok) throw new ErreurDirect(reponse.status);
  return (await reponse.json()) as T;
}

/**
 * The only way to build a live screen (never a hand-made setInterval). Can later
 * be backed by SSE without touching the screens.
 */
export function useLiveQuery<T>(
  cle: readonly unknown[],
  url: string,
  options: { intervalleMs?: number; actif?: boolean } = {},
): UseQueryResult<T> {
  return useQuery({
    queryKey: cle,
    queryFn: ({ signal }) => chargerDirect<T>(url, signal),
    enabled: options.actif ?? true,
    refetchInterval: options.intervalleMs ?? INTERVALLE_DIRECT_MS,
    refetchIntervalInBackground: false,
    // A locked or signed-out tablet (or an unpaired, foreign or revoked call screen) stops
    // retrying at once.
    retry: (echecs, erreur) =>
      !(erreur instanceof ErreurDirect && [401, 403, 404, 410, 423].includes(erreur.statut)) &&
      echecs < 2,
  });
}

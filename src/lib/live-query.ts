"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ENTETE_RAFRAICHISSEMENT_AUTO } from "@/lib/activite";

/** Live screens refresh every 3 to 5 seconds (cahier §9). */
export const INTERVALLE_DIRECT_MS = 4000;

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
export function useLiveQuery<T>(cle: readonly unknown[], url: string): UseQueryResult<T> {
  return useQuery({
    queryKey: cle,
    queryFn: ({ signal }) => chargerDirect<T>(url, signal),
    refetchInterval: INTERVALLE_DIRECT_MS,
    refetchIntervalInBackground: false,
    // A locked or signed-out tablet stops polling instead of retrying.
    retry: (echecs, erreur) =>
      !(erreur instanceof ErreurDirect && [401, 403, 423].includes(erreur.statut)) && echecs < 2,
  });
}

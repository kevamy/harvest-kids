import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { CHEMIN_COOKIE_ECRAN, COOKIE_ECRAN, DUREE_COOKIE_ECRAN_S } from "@/server/plateforme/ecran";

/**
 * The paired device's secret (ADR 0018): HttpOnly (never readable by a script), Secure,
 * SameSite=Lax, only sent to the call screen's API, kept 400 days and renewed while in use.
 */
export function poserCookieEcran(reponse: NextResponse, secret: string) {
  reponse.cookies.set({
    name: COOKIE_ECRAN,
    value: secret,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: CHEMIN_COOKIE_ECRAN,
    maxAge: DUREE_COOKIE_ECRAN_S,
  });
}

export const lireCookieEcran = (requete: NextRequest) => requete.cookies.get(COOKIE_ECRAN)?.value;

/** Answers of the call screen's API are never cached nor indexed. */
export const ENTETES_ECRAN = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

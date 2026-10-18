import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page and API request:
 * - security headers, with a per-request nonce for scripts (CSP);
 * - optimistic redirect to the sign-in page when there is no session cookie.
 * Real access control stays on the server (getTenantDb, rbac): a cookie is
 * only a hint here.
 */

const CHEMINS_PUBLICS = [
  "/connexion",
  "/design",
  "/hors-connexion",
  "/api/auth",
  "/api/sante",
  "/serwist",
];

function estPublic(chemin: string) {
  return CHEMINS_PUBLICS.some((p) => chemin === p || chemin.startsWith(`${p}/`));
}

export function politiqueSecurite(nonce: string, developpement: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developpement ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // Style attributes (e.g. the notch colour of NotchCard) carry no script.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!estPublic(pathname) && !getSessionCookie(request, { cookiePrefix: "hk" })) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ erreur: "Non authentifié" }, { status: 401 });
    }
    const connexion = new URL("/connexion", request.url);
    if (pathname !== "/") connexion.searchParams.set("retour", `${pathname}${search}`);
    return NextResponse.redirect(connexion);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = politiqueSecurite(nonce, process.env.NODE_ENV === "development");

  const entetesRequete = new Headers(request.headers);
  entetesRequete.set("x-nonce", nonce);
  entetesRequete.set("Content-Security-Policy", csp);

  const reponse = NextResponse.next({ request: { headers: entetesRequete } });
  reponse.headers.set("Content-Security-Policy", csp);
  reponse.headers.set("X-Content-Type-Options", "nosniff");
  reponse.headers.set("X-Frame-Options", "DENY");
  reponse.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // The scanner uses the tablet's camera (lot 1); nothing else is needed.
  reponse.headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  );
  if (process.env.NODE_ENV === "production") {
    reponse.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  return reponse;
}

export const config = {
  matcher: [
    // Everything except static assets, icons and logos.
    "/((?!_next/static|_next/image|icons/|logo/|icon.png|apple-icon.png|manifest.webmanifest).*)",
  ],
};

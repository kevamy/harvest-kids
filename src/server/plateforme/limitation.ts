import "server-only";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { prismaPlateforme } from "./db";

export type Regle = { fenetreMs: number; max: number };

const QUINZE_MINUTES = 15 * 60 * 1000;

/**
 * Per IP address, a guard only (ADR 0003): every tablet of a church shares the same public
 * address, so a church must never be blocked as a whole on a Sunday morning. Attempts are
 * counted first per person (identifier, member, link).
 */
export const GARDE_IP: Regle = { fenetreMs: QUINZE_MINUTES, max: 300 };

/** Sign-in attempts: per identifier (e-mail or phone), then the IP guard. */
export const REGLES_CONNEXION = {
  identifiant: { fenetreMs: QUINZE_MINUTES, max: 5 },
  ip: GARDE_IP,
} as const satisfies Record<string, Regle>;

/** Activation page attempts: per link (token fingerprint), then the IP guard (ADR 0014). */
export const REGLES_ACTIVATION = {
  jeton: { fenetreMs: QUINZE_MINUTES, max: 10 },
  ip: GARDE_IP,
} as const satisfies Record<string, Regle>;

/**
 * Wrong retrieval codes at check-out (cahier §7.6, ADR 0016): 5 per tablet and per session in
 * 15 minutes, then the tablet is blocked for the rest of the window and the reception desk
 * gets an alert. A tablet is a signed-in session; only wrong codes are counted.
 */
export const REGLE_CODE_RETRAIT: Regle = { fenetreMs: QUINZE_MINUTES, max: 5 };

/**
 * Wrong retrieval codes per session of worship, every tablet and every sign-in together
 * (ADR 0016): signing out and in again opens a new tablet counter, not a new session one.
 * At 20, code entry is blocked on every tablet for the rest of the session (card scan and
 * the check-out without card or code stay possible). A session never spans a day, so a
 * 24-hour window covers it whole; the next session has its own counter.
 */
export const REGLE_CODES_SESSION: Regle = { fenetreMs: 24 * 60 * 60 * 1000, max: 20 };

const PREFIXE_CODE_RETRAIT = "checkout-code:";
const PREFIXE_CODES_SESSION = "checkout-code-session:";

export const cleCodeRetrait = (egliseId: string, sessionId: string, tablette: string) =>
  `${PREFIXE_CODE_RETRAIT}${egliseId}:${sessionId}:${tablette}`;

export const cleCodesSession = (egliseId: string, sessionId: string) =>
  `${PREFIXE_CODES_SESSION}${egliseId}:${sessionId}`;

/** Where a tablet stands with wrong retrieval codes in a session. */
export type EtatCodeRetrait = {
  /** The limit reached, if any: the session one wins over the tablet one. */
  bloque: false | "tablette" | "session";
  reessayerDansMs: number;
  /** Wrong codes counted in the current windows: this tablet, every tablet of the session. */
  essais: number;
  essaisSession: number;
  /** Wrong codes still allowed before the nearer of the two blocks, and which one it is. */
  restants: number;
  prochainBlocage: "tablette" | "session";
};

/** Read only: both limits for this tablet in this session. */
export async function etatCodeRetrait(
  base: PrismaClient,
  egliseId: string,
  sessionId: string,
  tablette: string,
  maintenant: Date,
): Promise<EtatCodeRetrait> {
  const [parTablette, parSession] = await Promise.all([
    etatLimite(base, cleCodeRetrait(egliseId, sessionId, tablette), REGLE_CODE_RETRAIT, maintenant),
    etatLimite(base, cleCodesSession(egliseId, sessionId), REGLE_CODES_SESSION, maintenant),
  ]);
  const restantsTablette = Math.max(0, REGLE_CODE_RETRAIT.max - parTablette.essais);
  const restantsSession = Math.max(0, REGLE_CODES_SESSION.max - parSession.essais);
  const commun = {
    essais: parTablette.essais,
    essaisSession: parSession.essais,
    restants: Math.min(restantsTablette, restantsSession),
    prochainBlocage:
      restantsSession <= restantsTablette ? ("session" as const) : ("tablette" as const),
  };
  if (parSession.bloque) {
    return { bloque: "session", reessayerDansMs: parSession.reessayerDansMs, ...commun };
  }
  if (parTablette.bloque) {
    return { bloque: "tablette", reessayerDansMs: parTablette.reessayerDansMs, ...commun };
  }
  return { bloque: false, reessayerDansMs: 0, ...commun };
}

/** Counts one wrong retrieval code against the tablet and the session, then reads both. */
export async function compterCodeErroneDans(
  base: PrismaClient,
  egliseId: string,
  sessionId: string,
  tablette: string,
  maintenant: Date,
): Promise<EtatCodeRetrait> {
  await consommer(
    base,
    cleCodeRetrait(egliseId, sessionId, tablette),
    REGLE_CODE_RETRAIT,
    maintenant,
  );
  await consommer(base, cleCodesSession(egliseId, sessionId), REGLE_CODES_SESSION, maintenant);
  return etatCodeRetrait(base, egliseId, sessionId, tablette, maintenant);
}

/** Sessions of the church where code entry is blocked for every tablet. */
export async function sessionsCodesBloques(
  base: PrismaClient,
  egliseId: string,
  maintenant: Date,
): Promise<string[]> {
  const prefixe = `${PREFIXE_CODES_SESSION}${egliseId}:`;
  const lignes = await base.authRateLimit.findMany({
    where: {
      key: { startsWith: prefixe },
      count: { gte: REGLE_CODES_SESSION.max },
      lastRequest: { gt: BigInt(maintenant.getTime() - REGLE_CODES_SESSION.fenetreMs) },
    },
    select: { key: true },
  });
  return lignes.map((l) => l.key.slice(prefixe.length));
}

/** Read only: whether the counter has reached its maximum in the current window. */
export async function etatLimite(
  base: PrismaClient,
  cle: string,
  regle: Regle,
  maintenant: Date,
): Promise<{ bloque: boolean; essais: number; reessayerDansMs: number }> {
  const ligne = await base.authRateLimit.findUnique({
    where: { key: cle },
    select: { count: true, lastRequest: true },
  });
  const fin = ligne ? Number(ligne.lastRequest) + regle.fenetreMs : 0;
  if (!ligne || fin <= maintenant.getTime()) {
    return { bloque: false, essais: 0, reessayerDansMs: 0 };
  }
  const bloque = ligne.count >= regle.max;
  return {
    bloque,
    essais: ligne.count,
    reessayerDansMs: bloque ? fin - maintenant.getTime() : 0,
  };
}

/** Tablets of the church blocked for wrong retrieval codes now, by session. */
export async function tablettesBloquees(
  base: PrismaClient,
  egliseId: string,
  maintenant: Date,
): Promise<{ sessionId: string; reessayerDansMs: number }[]> {
  const prefixe = `${PREFIXE_CODE_RETRAIT}${egliseId}:`;
  const lignes = await base.authRateLimit.findMany({
    where: {
      key: { startsWith: prefixe },
      count: { gte: REGLE_CODE_RETRAIT.max },
      lastRequest: { gt: BigInt(maintenant.getTime() - REGLE_CODE_RETRAIT.fenetreMs) },
    },
    select: { key: true, lastRequest: true },
  });
  return lignes.map((l) => ({
    sessionId: l.key.slice(prefixe.length).split(":")[0]!,
    reessayerDansMs: Number(l.lastRequest) + REGLE_CODE_RETRAIT.fenetreMs - maintenant.getTime(),
  }));
}

/** Whether code entry is blocked for this tablet in this session (either limit). */
export function codeRetraitBloque(egliseId: string, sessionId: string, tablette: string) {
  return etatCodeRetrait(prismaPlateforme(), egliseId, sessionId, tablette, new Date());
}

/** Counts one wrong retrieval code; says whether the tablet or the session is now blocked. */
export function compterCodeErrone(egliseId: string, sessionId: string, tablette: string) {
  return compterCodeErroneDans(prismaPlateforme(), egliseId, sessionId, tablette, new Date());
}

/** The church's tablets blocked now (alert of the reception dashboard). */
export function tablettesBloqueesEglise(egliseId: string) {
  return tablettesBloquees(prismaPlateforme(), egliseId, new Date());
}

/** The church's sessions with code entry blocked (alert of the reception dashboard). */
export function sessionsCodesBloquesEglise(egliseId: string) {
  return sessionsCodesBloques(prismaPlateforme(), egliseId, new Date());
}

export const essaisConnexion = (identifiant: string, ip: string) =>
  [
    [`connexion:id:${identifiant}`, REGLES_CONNEXION.identifiant],
    [`connexion:ip:${ip}`, REGLES_CONNEXION.ip],
  ] as const;

export const essaisActivation = (empreinte: string, ip: string) =>
  [
    [`activation:jeton:${empreinte}`, REGLES_ACTIVATION.jeton],
    [`activation:ip:${ip}`, REGLES_ACTIVATION.ip],
  ] as const;

/**
 * Counts one attempt against each rule in order (the person first, then the IP guard)
 * and stops at the first one that refuses.
 */
export async function consommerDans(
  base: PrismaClient,
  essais: readonly (readonly [string, Regle])[],
  maintenant: Date,
): Promise<{ autorise: boolean; reessayerDansMs: number }> {
  for (const [cle, regle] of essais) {
    const resultat = await consommer(base, cle, regle, maintenant);
    if (!resultat.autorise) return resultat;
  }
  return { autorise: true, reessayerDansMs: 0 };
}

/**
 * Fixed-window counter stored in AuthRateLimit (shared across instances).
 * Check and increment happen in one statement, so concurrent attempts cannot
 * all slip under the limit.
 */
export async function consommer(
  base: PrismaClient,
  cle: string,
  regle: Regle,
  maintenant: Date,
): Promise<{ autorise: boolean; reessayerDansMs: number }> {
  const t = BigInt(maintenant.getTime());
  const debutFenetre = t - BigInt(regle.fenetreMs);
  const [ligne] = await base.$queryRaw<{ count: number; lastRequest: bigint }[]>`
    INSERT INTO "AuthRateLimit" (id, key, count, "lastRequest")
    VALUES (${randomUUID()}, ${cle}, 1, ${t})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN "AuthRateLimit"."lastRequest" <= ${debutFenetre}
                   THEN 1 ELSE "AuthRateLimit".count + 1 END,
      "lastRequest" = CASE WHEN "AuthRateLimit"."lastRequest" <= ${debutFenetre}
                   THEN ${t} ELSE "AuthRateLimit"."lastRequest" END
    RETURNING count, "lastRequest"`;
  const autorise = (ligne?.count ?? 0) <= regle.max;
  const fin = Number(ligne?.lastRequest ?? t) + regle.fenetreMs;
  return { autorise, reessayerDansMs: autorise ? 0 : Math.max(0, fin - maintenant.getTime()) };
}

export async function oublier(base: PrismaClient, cle: string) {
  await base.authRateLimit.deleteMany({ where: { key: cle } });
}

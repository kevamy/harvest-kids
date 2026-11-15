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

const PREFIXE_CODE_RETRAIT = "checkout-code:";

export const cleCodeRetrait = (egliseId: string, sessionId: string, tablette: string) =>
  `${PREFIXE_CODE_RETRAIT}${egliseId}:${sessionId}:${tablette}`;

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

/** Whether the tablet is blocked for wrong retrieval codes in this session. */
export function codeRetraitBloque(egliseId: string, sessionId: string, tablette: string) {
  return etatLimite(
    prismaPlateforme(),
    cleCodeRetrait(egliseId, sessionId, tablette),
    REGLE_CODE_RETRAIT,
    new Date(),
  );
}

/** Counts one wrong retrieval code; says whether the tablet is now blocked. */
export async function compterCodeErrone(egliseId: string, sessionId: string, tablette: string) {
  const base = prismaPlateforme();
  const cle = cleCodeRetrait(egliseId, sessionId, tablette);
  const maintenant = new Date();
  await consommer(base, cle, REGLE_CODE_RETRAIT, maintenant);
  return etatLimite(base, cle, REGLE_CODE_RETRAIT, maintenant);
}

/** The church's tablets blocked now (alert of the reception dashboard). */
export function tablettesBloqueesEglise(egliseId: string) {
  return tablettesBloquees(prismaPlateforme(), egliseId, new Date());
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

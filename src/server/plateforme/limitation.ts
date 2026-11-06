import "server-only";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

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

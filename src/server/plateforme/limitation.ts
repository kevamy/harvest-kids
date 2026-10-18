import "server-only";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

export type Regle = { fenetreMs: number; max: number };

/** Sign-in attempts: per identifier, and per IP address (shared tablets share an IP). */
export const REGLES_CONNEXION = {
  identifiant: { fenetreMs: 15 * 60 * 1000, max: 5 },
  ip: { fenetreMs: 15 * 60 * 1000, max: 30 },
} as const satisfies Record<string, Regle>;

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

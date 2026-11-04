import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * Raw Prisma client, connected as hk_app (subject to Row-Level Security).
 * Reserved to platform code, lib/tenant.ts and lib/auth.ts (ESLint rule):
 * church data is only reached through getTenantDb().
 */
export function creerClientPlateforme(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const globalPourPrisma = globalThis as unknown as { prismaPlateforme?: PrismaClient };

/** Shared instance (reused across hot reloads in development). */
export function prismaPlateforme(): PrismaClient {
  globalPourPrisma.prismaPlateforme ??= creerClientPlateforme(env().DATABASE_URL);
  return globalPourPrisma.prismaPlateforme;
}

export type TransactionPrisma = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Runs `fn` inside one church, for platform operations that write into it
 * (default classes and services when a church is created, seed).
 * Same mechanism as getTenantDb(): app.eglise_id is set for the transaction only.
 */
export async function withEglise<T>(
  base: PrismaClient,
  egliseId: string,
  fn: (tx: TransactionPrisma) => Promise<T>,
  // `timeout` (ms) lengthens Prisma's 5 s limit for bulk work (badges of every monitor).
  options: { timeout?: number } = {},
): Promise<T> {
  return base.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.eglise_id', ${egliseId}, TRUE)`;
      return fn(tx);
    },
    options.timeout ? { timeout: options.timeout } : undefined,
  );
}

import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

type Transaction = Awaited<
  ReturnType<Awaited<ReturnType<PrismaPg["connect"]>>["startTransaction"]>
>;

/**
 * Chains the queries of one transaction. Prisma 7 runs the independent reads of a query
 * (the relations of a `select`) in parallel; inside a transaction they share one pg
 * connection, which pg 8 queues with a deprecation warning and pg 9 will refuse. Every
 * scoped query runs in a transaction (app.eglise_id first), so this covers them all.
 */
function sequentielle(tx: Transaction): Transaction {
  let file: Promise<unknown> = Promise.resolve();
  const enFile = <T>(operation: () => Promise<T>): Promise<T> => {
    const resultat = file.then(operation, operation);
    file = resultat.catch(() => undefined);
    return resultat;
  };
  const queryRaw = tx.queryRaw.bind(tx);
  const executeRaw = tx.executeRaw.bind(tx);
  tx.queryRaw = (requete) => enFile(() => queryRaw(requete));
  tx.executeRaw = (requete) => enFile(() => executeRaw(requete));
  return tx;
}

class PrismaPgSequentiel extends PrismaPg {
  override async connect() {
    const adaptateur = await super.connect();
    const commencer = adaptateur.startTransaction.bind(adaptateur);
    adaptateur.startTransaction = async (niveau) => sequentielle(await commencer(niveau));
    return adaptateur;
  }
}

/**
 * Raw Prisma client, connected as hk_app (subject to Row-Level Security).
 * Reserved to platform code, lib/tenant.ts and lib/auth.ts (ESLint rule):
 * church data is only reached through getTenantDb().
 */
export function creerClientPlateforme(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPgSequentiel({ connectionString }) });
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

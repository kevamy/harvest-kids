import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient, Role } from "@/generated/prisma/client";
import { formatMatricule } from "@/lib/matricule";
import { getSessionCourante, type SessionCourante } from "@/lib/session";
import { prismaPlateforme } from "@/server/plateforme/db";

/**
 * Single entry point to a church's data (CLAUDE.md, ADR 0002).
 *
 * First barrier: the scoped client below adds the active church to every read and
 * write and refuses platform tables. Second barrier: PostgreSQL Row-Level Security,
 * driven by app.eglise_id, set for each transaction.
 */

/** Church tables: under RLS, reachable through the scoped client only. */
export const MODELES_EGLISE = [
  "Famille",
  "Tuteur",
  "PersonneAutorisee",
  "Enfant",
  "CarteFamille",
  "Classe",
  "Culte",
  "Session",
  "SessionClasse",
  "AffectationMoniteur",
  "Presence",
  "EvenementPresence",
  "Appel",
  "AppelTelephonique",
  "Incident",
  "AuditLog",
  "Parametre",
] as const;

const MODELES = new Set<string>(MODELES_EGLISE);

export type RaisonRefus =
  "non_authentifie" | "aucune_eglise" | "non_membre" | "compte_inactif" | "eglise_suspendue";

/** Access to the active church is refused (the caller answers 401/403 or redirects). */
export class AccesRefuse extends Error {
  constructor(readonly raison: RaisonRefus) {
    super(`Accès refusé : ${raison}`);
    this.name = "AccesRefuse";
  }
}

/** A query tried to name another church, or to reach a platform table. */
export class RequeteHorsEglise extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequeteHorsEglise";
  }
}

export type ContexteEglise = {
  egliseId: string;
  userId: string;
  membreId: string;
  roles: Role[];
};

/**
 * Checks that the session's active church is one the user belongs to, that the
 * membership and the account are active and that the church is not suspended.
 * The church always comes from the session, never from the request.
 */
export async function verifierContexte(
  base: PrismaClient,
  session: SessionCourante | null,
): Promise<ContexteEglise> {
  if (!session) throw new AccesRefuse("non_authentifie");
  if (!session.egliseActiveId) throw new AccesRefuse("aucune_eglise");

  const membre = await base.membre.findUnique({
    where: { egliseId_userId: { egliseId: session.egliseActiveId, userId: session.userId } },
    select: {
      id: true,
      roles: true,
      actif: true,
      user: { select: { actif: true } },
      eglise: { select: { statut: true } },
    },
  });
  if (!membre || !membre.actif) throw new AccesRefuse("non_membre");
  if (!membre.user.actif) throw new AccesRefuse("compte_inactif");
  if (membre.eglise.statut !== "ACTIVE") throw new AccesRefuse("eglise_suspendue");

  return {
    egliseId: session.egliseActiveId,
    userId: session.userId,
    membreId: membre.id,
    roles: membre.roles,
  };
}

// ---------------------------------------------------------------------------
// Scoped client
// ---------------------------------------------------------------------------

const OPERATIONS_AVEC_WHERE = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

type Args = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: Record<string, unknown>;
  update?: Record<string, unknown>;
};

function injecterEglise(operation: string, args: Args | undefined, egliseId: string): Args {
  const resultat: Args = { ...(args ?? {}) };

  const verifier = (valeur: unknown) => {
    if (valeur !== undefined && valeur !== egliseId) {
      throw new RequeteHorsEglise("Une requête ne peut pas viser une autre église.");
    }
  };
  // New rows always belong to the active church.
  const pourCreation = (data: unknown) => {
    const ligne = (data ?? {}) as Record<string, unknown>;
    verifier(ligne.egliseId);
    return { ...ligne, egliseId };
  };
  // Updates cannot move a row to another church.
  const pourModification = (data: unknown) => {
    verifier((data as Record<string, unknown> | undefined)?.egliseId);
    return data;
  };

  if (OPERATIONS_AVEC_WHERE.has(operation)) {
    verifier(resultat.where?.egliseId);
    resultat.where = { ...(resultat.where ?? {}), egliseId };
  }

  switch (operation) {
    case "create":
      resultat.data = pourCreation(resultat.data);
      break;
    case "createMany":
    case "createManyAndReturn":
      resultat.data = Array.isArray(resultat.data)
        ? resultat.data.map(pourCreation)
        : pourCreation(resultat.data);
      break;
    case "update":
    case "updateMany":
    case "updateManyAndReturn":
      resultat.data = pourModification(resultat.data);
      break;
    case "upsert":
      resultat.create = pourCreation(resultat.create);
      resultat.update = pourModification(resultat.update) as Record<string, unknown>;
      break;
  }
  return resultat;
}

/** Interactive transaction in progress, by church (set by $tx). */
const transactionEnCours = new AsyncLocalStorage<string>();

function etendre(base: PrismaClient, egliseId: string) {
  return base.$extends({
    name: "eglise-active",
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (model && !MODELES.has(model)) {
          throw new RequeteHorsEglise(`La table ${model} n'est pas accessible depuis une église.`);
        }
        const argsEglise = model ? injecterEglise(operation, args as Args, egliseId) : args;

        // Inside $tx, app.eglise_id is already set for the whole transaction.
        if (transactionEnCours.getStore() === egliseId) return query(argsEglise);

        // Otherwise each query runs in its own transaction, with the setting first.
        const [, resultat] = await base.$transaction([
          base.$executeRaw`SELECT set_config('app.eglise_id', ${egliseId}, TRUE)`,
          query(argsEglise),
        ]);
        return resultat;
      },
    },
  });
}

type ClientEtendu = ReturnType<typeof etendre>;

/** Platform tables are hidden from the type as well as refused at runtime. */
type TablesPlateforme =
  | "eglise"
  | "user"
  | "membre"
  | "accesSupport"
  | "auditPlateforme"
  | "authSession"
  | "authAccount"
  | "authVerification"
  | "authRateLimit";

type ClientDeBase = Omit<
  ClientEtendu,
  TablesPlateforme | "$transaction" | "$extends" | "$connect" | "$disconnect" | "$on"
>;

export type ClientEglise = ClientDeBase & {
  readonly egliseId: string;
  /** Several operations in one transaction, inside the active church. */
  $tx<T>(fn: (tx: ClientDeBase) => Promise<T>): Promise<T>;
};

export function clientEglise(base: PrismaClient, egliseId: string): ClientEglise {
  const etendu = etendre(base, egliseId);
  const $tx = <T>(fn: (tx: ClientDeBase) => Promise<T>): Promise<T> =>
    etendu.$transaction((tx) =>
      transactionEnCours.run(egliseId, async () => {
        await tx.$executeRaw`SELECT set_config('app.eglise_id', ${egliseId}, TRUE)`;
        return fn(tx as unknown as ClientDeBase);
      }),
    );
  return new Proxy(etendu, {
    get(cible, propriete) {
      if (propriete === "egliseId") return egliseId;
      if (propriete === "$tx") return $tx;
      if (typeof propriete === "string" && PROPRIETES_INTERDITES.has(propriete)) {
        throw new RequeteHorsEglise(`« ${propriete} » n'est pas accessible depuis une église.`);
      }
      return Reflect.get(cible, propriete, cible);
    },
  }) as unknown as ClientEglise;
}

const PROPRIETES_INTERDITES = new Set<string>([
  "eglise",
  "user",
  "membre",
  "accesSupport",
  "auditPlateforme",
  "authSession",
  "authAccount",
  "authVerification",
  "authRateLimit",
  "$transaction",
  "$extends",
  "$connect",
  "$disconnect",
  "$on",
]);

/**
 * RG-01: next matricule of the active church, incremented atomically and never reused.
 * Call it inside $tx, in the same transaction as the child's creation.
 */
export async function attribuerMatricule(db: Pick<ClientDeBase, "$queryRaw">): Promise<string> {
  // hk_eglise_active() reads app.eglise_id: the counter can only be the active church's.
  const lignes = await db.$queryRaw<{ numero: number }[]>`
    UPDATE "Eglise" SET "prochainMatricule" = "prochainMatricule" + 1
    WHERE id = hk_eglise_active()
    RETURNING "prochainMatricule" - 1 AS numero`;
  const numero = lignes[0]?.numero;
  if (numero === undefined) throw new RequeteHorsEglise("Aucune église active.");
  return formatMatricule(Number(numero));
}

/** Active church of the current session, checked against its membership. */
export async function getEgliseActive(): Promise<ContexteEglise> {
  return verifierContexte(prismaPlateforme(), await getSessionCourante());
}

/** Scoped client of the active church, plus the checked context (roles for rbac). */
export async function getTenantDb(): Promise<{ db: ClientEglise; contexte: ContexteEglise }> {
  const contexte = await getEgliseActive();
  return { db: clientEglise(prismaPlateforme(), contexte.egliseId), contexte };
}

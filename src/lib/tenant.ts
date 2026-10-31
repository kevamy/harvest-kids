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
  "ReemissionCartes",
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
  "FichierASupprimer",
] as const;

const MODELES = new Set<string>(MODELES_EGLISE);

export type RaisonRefus =
  | "non_authentifie"
  | "verrouille"
  | "aucune_eglise"
  | "non_membre"
  | "compte_inactif"
  | "eglise_suspendue";

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

declare const contexteVerifie: unique symbol;

/**
 * Checked context of the active church. Only verifierContexte() produces one (the brand
 * cannot be written by hand without an explicit cast): a service that receives it gets
 * a church taken from the session, never from a call argument.
 */
export type ContexteEglise = {
  egliseId: string;
  userId: string;
  membreId: string;
  roles: Role[];
  /** Short device description for the audit log (user agent). */
  appareil: string | null;
  readonly [contexteVerifie]: true;
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
  // A locked tablet reaches no church data until the PIN is entered.
  if (session.verrouillee) throw new AccesRefuse("verrouille");
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
    appareil: session.appareil,
  } as ContexteEglise;
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

// Arguments that name fields to return or sort by, not rows: an `egliseId` key there
// (`select: { egliseId: true }`) designates nothing. Query arguments nested inside
// them (`include: { cartes: { where: … } }`) are checked again.
const PROJECTIONS = new Set(["select", "include", "omit", "orderBy", "_count"]);
const ARGUMENTS_DE_REQUETE = new Set(["where", "cursor", "having"]);

const estObjetSimple = (valeur: unknown): valeur is Record<string, unknown> => {
  if (typeof valeur !== "object" || valeur === null) return false;
  const prototype = Object.getPrototypeOf(valeur);
  return prototype === Object.prototype || prototype === null;
};

/** The only ways an `egliseId` may be written: the active church, nothing else. */
function designeEgliseActive(valeur: unknown, egliseId: string): boolean {
  if (valeur === egliseId) return true;
  if (!estObjetSimple(valeur)) return false;
  const operateurs = Object.entries(valeur).filter(([, v]) => v !== undefined);
  return (
    operateurs.length > 0 &&
    operateurs.every(([operateur, v]) =>
      operateur === "equals" || operateur === "set"
        ? v === egliseId
        : operateur === "in"
          ? Array.isArray(v) && v.length > 0 && v.every((id) => id === egliseId)
          : false,
    )
  );
}

/**
 * Walks every argument of a query, at any depth (where, data, create, update, connect,
 * connectOrCreate, compound unique keys, relation filters, nested writes…), and refuses
 * the query as soon as an `egliseId` names anything but the active church. Any filter
 * on `egliseId` other than equality (`not`, `notIn`, ranges…) is refused too: it would
 * designate other churches. The `eglise` relation is never named either: the church
 * comes from the session. No list of known keys: a new compound key is covered.
 */
export function verifierArgumentsEglise(
  valeur: unknown,
  egliseId: string,
  projection = false,
): void {
  if (Array.isArray(valeur)) {
    for (const element of valeur) verifierArgumentsEglise(element, egliseId, projection);
    return;
  }
  if (!estObjetSimple(valeur)) return;
  for (const [cle, contenu] of Object.entries(valeur)) {
    if (contenu === undefined) continue;
    if (projection) {
      verifierArgumentsEglise(contenu, egliseId, !ARGUMENTS_DE_REQUETE.has(cle));
      continue;
    }
    if (cle === "egliseId") {
      if (!designeEgliseActive(contenu, egliseId)) {
        throw new RequeteHorsEglise("Une requête ne peut pas viser une autre église.");
      }
      continue;
    }
    if (cle === "eglise") {
      throw new RequeteHorsEglise(
        "La relation « eglise » ne se nomme pas dans une requête : l'église vient de la session.",
      );
    }
    verifierArgumentsEglise(contenu, egliseId, PROJECTIONS.has(cle));
  }
}

function injecterEglise(operation: string, args: Args | undefined, egliseId: string): Args {
  verifierArgumentsEglise(args, egliseId);
  const resultat: Args = { ...(args ?? {}) };

  // New rows always belong to the active church.
  const pourCreation = (data: unknown) => ({ ...((data ?? {}) as object), egliseId });

  if (OPERATIONS_AVEC_WHERE.has(operation)) {
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
    case "upsert":
      resultat.create = pourCreation(resultat.create);
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

/** Scoped client inside $tx (and the operations shared with the full client). */
export type ClientDeBase = Omit<
  ClientEtendu,
  TablesPlateforme | "$transaction" | "$extends" | "$connect" | "$disconnect" | "$on"
>;

export type ClientEglise = ClientDeBase & {
  readonly egliseId: string;
  /**
   * Several operations in one transaction, inside the active church. `timeout` (ms)
   * lengthens Prisma's 5 s limit for bulk work (card reissue).
   */
  $tx<T>(fn: (tx: ClientDeBase) => Promise<T>, options?: { timeout?: number }): Promise<T>;
};

export function clientEglise(base: PrismaClient, egliseId: string): ClientEglise {
  const etendu = etendre(base, egliseId);
  const $tx = <T>(
    fn: (tx: ClientDeBase) => Promise<T>,
    options: { timeout?: number } = {},
  ): Promise<T> =>
    etendu.$transaction(
      (tx) =>
        transactionEnCours.run(egliseId, async () => {
          await tx.$executeRaw`SELECT set_config('app.eglise_id', ${egliseId}, TRUE)`;
          return fn(tx as unknown as ClientDeBase);
        }),
      options.timeout ? { timeout: options.timeout } : undefined,
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
export type OptionsAcces = {
  /** Automatic refresh of a live screen: does not count as user activity. */
  rafraichissementAuto?: boolean;
};

export async function getEgliseActive(options: OptionsAcces = {}): Promise<ContexteEglise> {
  return verifierContexte(prismaPlateforme(), await getSessionCourante(options));
}

/** Scoped client of the active church, plus the checked context (roles for rbac). */
export async function getTenantDb(
  options: OptionsAcces = {},
): Promise<{ db: ClientEglise; contexte: ContexteEglise }> {
  const contexte = await getEgliseActive(options);
  return { db: clientEglise(prismaPlateforme(), contexte.egliseId), contexte };
}

import pg from "pg";
import type { ContexteEglise } from "@/lib/tenant";
import { urlsDeTest } from "./urls";

export type Client = pg.Client;

export async function connecter(role: "app" | "proprietaire"): Promise<pg.Client> {
  const urls = urlsDeTest();
  const client = new pg.Client({ connectionString: role === "app" ? urls.app : urls.migration });
  await client.connect();
  return client;
}

/** Runs `fn` in a transaction where app.eglise_id is set, as getTenantDb() does. */
export async function enEglise<T>(
  client: pg.Client,
  egliseId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.eglise_id', $1, true)", [egliseId]);
    const resultat = await fn();
    await client.query("COMMIT");
    return resultat;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** Empties every application table (owner role; TRUNCATE is not subject to RLS). */
export async function viderBase(proprietaire: pg.Client) {
  const { rows } = await proprietaire.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
  await proprietaire.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

/** Prefix of the throwaway databases where the migration tests replay their migration. */
export const PREFIXE_BASE_MIGRATION = "hk_migration_";

/**
 * Drops a throwaway database. A background process (autovacuum) briefly connected to it
 * makes WITH (FORCE) fail with "permission denied to terminate process": up to 5 attempts,
 * 500 ms apart; the last error is thrown, so a cleanup that keeps failing stays visible.
 */
export async function supprimerBase(proprietaire: pg.Client, nom: string) {
  for (let essai = 1; ; essai++) {
    try {
      await proprietaire.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
      return;
    } catch (erreur) {
      if (essai === 5) throw erreur;
      await new Promise((fin) => setTimeout(fin, 500));
    }
  }
}

/** Drops the throwaway databases left by an earlier run whose cleanup failed. */
export async function purgerBasesDeMigration(proprietaire: pg.Client) {
  const { rows } = await proprietaire.query<{ datname: string }>(
    `SELECT datname FROM pg_database WHERE starts_with(datname, $1)`,
    [PREFIXE_BASE_MIGRATION],
  );
  for (const { datname } of rows) await supprimerBase(proprietaire, datname);
}

/** A quoted church table name; anything else is refused (the name goes into the SQL text). */
function tableEglise(table: string): string {
  if (!/^[A-Z][A-Za-z]+$/.test(table)) throw new Error(`Nom de table refusé : ${table}`);
  return `"${table}"`;
}

/**
 * Rows of a church table that belong to one church: the general case. The filter on the
 * church is explicit, because RLS alone does not confine a test: the owner role reads
 * CarteFamille and BadgeMoniteur in every church (policy rg14_lecture_proprietaire, RG-14).
 * `condition` is an optional fixed SQL fragment, e.g. `statut = 'PRESENT'`.
 */
export async function compterDansEglise(
  client: pg.Client,
  table: string,
  egliseId: string,
  condition?: string,
): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${tableEglise(table)}
     WHERE "egliseId" = $1${condition ? ` AND (${condition})` : ""}`,
    [egliseId],
  );
  return rows[0]!.n;
}

/**
 * Rows of a church table with no filter at all: reserved for isolation proofs, and each call
 * says in a comment what it proves. Inside a church (app role, or owner under FORCE RLS), it
 * proves that RLS hides the rows of the other churches; with no active church, that RLS hides
 * every row. Never on CarteFamille or BadgeMoniteur through the owner role, which reads them
 * in every church (policy rg14_lecture_proprietaire).
 */
export async function compterToutesEglises(
  client: pg.Client,
  table: string,
  condition?: string,
): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${tableEglise(table)}${condition ? ` WHERE ${condition}` : ""}`,
  );
  return rows[0]!.n;
}

/** Error code of a failed query, e.g. 42501 (RLS / privilege), 23503 (FK), 23505 (unique). */
export async function codeErreur(promesse: Promise<unknown>): Promise<string | undefined> {
  try {
    await promesse;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

export type Jeu = {
  egliseId: string;
  familleId: string;
  enfantId: string;
  classeId: string;
  sessionId: string;
};

/**
 * Minimal fixture for one church: church, family, child, class, session.
 * Inserted as the owner role, inside the church (FORCE RLS applies to the owner too).
 */
export async function creerEglise(proprietaire: pg.Client, suffixe: string): Promise<Jeu> {
  const jeu: Jeu = {
    egliseId: `eglise_${suffixe}`,
    familleId: `famille_${suffixe}`,
    enfantId: `enfant_${suffixe}`,
    classeId: `classe_${suffixe}`,
    sessionId: `session_${suffixe}`,
  };
  await proprietaire.query(
    `INSERT INTO "Eglise" (id, nom, slug, "ecranToken", "updatedAt")
     VALUES ($1, $2, $3, $4, now())`,
    [jeu.egliseId, `Église ${suffixe}`, `eglise-${suffixe}`, `ecran_${suffixe}`],
  );
  await enEglise(proprietaire, jeu.egliseId, async () => {
    await proprietaire.query(
      `INSERT INTO "Famille" (id, "egliseId", nom, "finaliseeLe", "updatedAt") VALUES ($1, $2, $3, now(), now())`,
      [jeu.familleId, jeu.egliseId, `Famille ${suffixe}`],
    );
    await proprietaire.query(
      `INSERT INTO "Enfant" (id, "egliseId", matricule, "familleId", prenom, nom, "dateNaissance", "updatedAt")
       VALUES ($1, $2, 'HK-0001', $3, 'Prénom', $4, '2020-01-01', now())`,
      [jeu.enfantId, jeu.egliseId, jeu.familleId, `Nom ${suffixe}`],
    );
    await proprietaire.query(
      `INSERT INTO "Classe" (id, "egliseId", nom, "ageMinMois", "ageMaxMois") VALUES ($1, $2, '3–5 ans', 36, 71)`,
      [jeu.classeId, jeu.egliseId],
    );
    await proprietaire.query(
      `INSERT INTO "Session" (id, "egliseId", date, debut, fin) VALUES ($1, $2, '2026-10-18', now(), now() + interval '2 hours')`,
      [jeu.sessionId, jeu.egliseId],
    );
  });
  return jeu;
}

/**
 * Checked context of a church member, as verifierContexte() returns it after reading the
 * session (the brand is only cast here, in tests). Services never take a church otherwise.
 */
export function contexteVerifie(jeu: Jeu): ContexteEglise {
  return {
    egliseId: jeu.egliseId,
    userId: "user_test",
    membreId: `membre_${jeu.egliseId}`,
    roles: ["ADMIN"],
    appareil: null,
  } as unknown as ContexteEglise;
}

import pg from "pg";
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

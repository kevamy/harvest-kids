/**
 * The badge migration (prisma/migrations/20261031150000_badges_moniteurs) moves badge
 * fingerprints from Membre to BadgeMoniteur before dropping the column. It is replayed here,
 * file as is, on throwaway databases at the state just before it: once normally, once
 * sabotaged so that a fingerprint is not copied, which must abort the migration without
 * losing anything.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, connecter } from "./support/db";
import { urlsDeTest } from "./support/urls";

const DOSSIER = join(process.cwd(), "prisma", "migrations");
const BADGES = "20261031150000_badges_moniteurs";

const empreinte = (jeton: string) => createHash("sha256").update(jeton, "utf8").digest("hex");
const ACTIF = empreinte("HKB1.AAAAAAAAAAAAAAAAAAAAAA");
const DESACTIVE = empreinte("HKB1.DDDDDDDDDDDDDDDDDDDDDD");
const ANCIEN_MONITEUR = empreinte("HKB1.RRRRRRRRRRRRRRRRRRRRRR");

let proprietaire: Client;
const basesCreees: string[] = [];

const sql = (migration: string) => readFile(join(DOSSIER, migration, "migration.sql"), "utf8");

/** New database with every migration before the badge one, and three members with badges. */
async function baseAvantBadges(): Promise<pg.Client> {
  const nom = `hk_migration_${randomBytes(4).toString("hex")}`;
  await proprietaire.query(`CREATE DATABASE ${nom}`);
  basesCreees.push(nom);
  const url = new URL(urlsDeTest().migration);
  url.pathname = `/${nom}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();

  const migrations = (await readdir(DOSSIER, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && e.name < BADGES)
    .map((e) => e.name)
    .sort();
  for (const migration of migrations) await client.query(await sql(migration));
  await client.query(`
    INSERT INTO "Eglise" (id, nom, slug, "ecranToken", "updatedAt")
      VALUES ('eglise_m', 'Église M', 'eglise-m', 'ecran_m', now());
    INSERT INTO "User" (id, name, email, "updatedAt") VALUES
      ('user_1', 'Actif', '1@harvest-kids.test', now()),
      ('user_2', 'Désactivé', '2@harvest-kids.test', now()),
      ('user_3', 'Ancien moniteur', '3@harvest-kids.test', now()),
      ('user_4', 'Sans badge', '4@harvest-kids.test', now());
    INSERT INTO "Membre" (id, "egliseId", "userId", roles, actif, "badgeTokenHash", "updatedAt") VALUES
      ('membre_1', 'eglise_m', 'user_1', '{MONITEUR}', true, '${ACTIF}', now()),
      ('membre_2', 'eglise_m', 'user_2', '{MONITEUR}', false, '${DESACTIVE}', now()),
      ('membre_3', 'eglise_m', 'user_3', '{ACCUEIL}', true, '${ANCIEN_MONITEUR}', now()),
      ('membre_4', 'eglise_m', 'user_4', '{MONITEUR}', true, NULL, now());`);
  return client;
}

/** Applies the badge migration in a transaction, as prisma migrate deploy does. */
async function migrer(client: pg.Client) {
  const script = await sql(BADGES);
  await client.query("BEGIN");
  try {
    await client.query(script);
    await client.query("COMMIT");
  } catch (erreur) {
    await client.query("ROLLBACK");
    throw erreur;
  }
}

async function colonnes(client: pg.Client, table: string) {
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
    [table],
  );
  return rows.map((r) => r.column_name);
}

beforeAll(async () => {
  proprietaire = await connecter("proprietaire");
});

afterAll(async () => {
  for (const nom of basesCreees) {
    await proprietaire.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
  }
  await proprietaire?.end();
});

describe("migration des badges moniteurs", () => {
  it("recopie chaque empreinte dans BadgeMoniteur, sous RLS forcée, puis retire la colonne", async () => {
    const client = await baseAvantBadges();
    try {
      await migrer(client);
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.eglise_id', 'eglise_m', true)");
      const { rows } = await client.query(
        `SELECT "membreId", "tokenHash", "revoqueLe" IS NOT NULL AS revoque
         FROM "BadgeMoniteur" ORDER BY "membreId"`,
      );
      await client.query("COMMIT");
      // A member deactivated, or without the MONITEUR role, gets a revoked badge.
      expect(rows).toEqual([
        { membreId: "membre_1", tokenHash: ACTIF, revoque: false },
        { membreId: "membre_2", tokenHash: DESACTIVE, revoque: true },
        { membreId: "membre_3", tokenHash: ANCIEN_MONITEUR, revoque: true },
      ]);
      expect(await colonnes(client, "Membre")).not.toContain("badgeTokenHash");
    } finally {
      await client.end();
    }
  });

  it("s'interrompt sans rien perdre si une empreinte n'est pas recopiée", async () => {
    const client = await baseAvantBadges();
    try {
      // Sabotage: while the copy runs (an active church set), one member is hidden; the
      // count of expected badges (no active church) still sees it.
      await client.query(`
        ALTER TABLE "Membre" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE "Membre" FORCE ROW LEVEL SECURITY;
        CREATE POLICY sabotage ON "Membre" USING (
          coalesce(current_setting('app.eglise_id', true), '') = '' OR id <> 'membre_1'
        );`);
      await expect(migrer(client)).rejects.toThrow(
        "Migration interrompue : 2 empreinte(s) de badge sur 3 copiée(s), Membre conservé.",
      );

      expect(await colonnes(client, "Membre")).toContain("badgeTokenHash");
      const { rows: table } = await client.query(`SELECT to_regclass('"BadgeMoniteur"') AS t`);
      expect(table).toEqual([{ t: null }]);
      // Sabotage removed (Membre is a platform table, outside RLS) to read every member.
      await client.query(`
        DROP POLICY sabotage ON "Membre";
        ALTER TABLE "Membre" NO FORCE ROW LEVEL SECURITY;
        ALTER TABLE "Membre" DISABLE ROW LEVEL SECURITY;`);
      const { rows } = await client.query(
        `SELECT id, "badgeTokenHash" FROM "Membre" WHERE "badgeTokenHash" IS NOT NULL ORDER BY id`,
      );
      expect(rows).toEqual([
        { id: "membre_1", badgeTokenHash: ACTIF },
        { id: "membre_2", badgeTokenHash: DESACTIVE },
        { id: "membre_3", badgeTokenHash: ANCIEN_MONITEUR },
      ]);
    } finally {
      await client.end();
    }
  });
});

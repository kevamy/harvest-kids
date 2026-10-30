/**
 * The lot 1 migration (prisma/migrations/20261030120000_cartes_lot1) converts clear tokens
 * into fingerprints before dropping them. It is replayed here, file as is, on throwaway
 * databases holding pre-lot-1 data: once normally, once sabotaged so that a fingerprint
 * is missing, which must abort the migration without losing the clear tokens.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, connecter } from "./support/db";
import { urlsDeTest } from "./support/urls";

const DOSSIER = join(process.cwd(), "prisma", "migrations");
const AVANT = ["20261018003254_init", "20261018003400_rls"];
const LOT1 = "20261030120000_cartes_lot1";

const JETON_CARTE = "HKF1.AAAAAAAAAAAAAAAAAAAAAA";
const JETON_BADGE = "HKB1.BBBBBBBBBBBBBBBBBBBBBB";
const empreinte = (jeton: string) => createHash("sha256").update(jeton, "utf8").digest("hex");

let proprietaire: Client;
const basesCreees: string[] = [];

const sql = (migration: string) => readFile(join(DOSSIER, migration, "migration.sql"), "utf8");

/** New database at the state before lot 1, with one church, family, card and badge. */
async function baseAvantLot1(): Promise<pg.Client> {
  const nom = `hk_migration_${randomBytes(4).toString("hex")}`;
  await proprietaire.query(`CREATE DATABASE ${nom}`);
  basesCreees.push(nom);
  const url = new URL(urlsDeTest().migration);
  url.pathname = `/${nom}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();

  for (const migration of AVANT) await client.query(await sql(migration));
  await client.query(`
    INSERT INTO "Eglise" (id, nom, slug, "ecranToken", "updatedAt")
      VALUES ('eglise_m', 'Église M', 'eglise-m', 'ecran_m', now());
    INSERT INTO "User" (id, name, email, "updatedAt")
      VALUES ('user_m', 'M', 'm@harvest-kids.test', now());
    INSERT INTO "Membre" (id, "egliseId", "userId", roles, "badgeToken", "updatedAt")
      VALUES ('membre_m', 'eglise_m', 'user_m', '{MONITEUR}', '${JETON_BADGE}', now());
    BEGIN;
    SELECT set_config('app.eglise_id', 'eglise_m', true);
    INSERT INTO "Famille" (id, "egliseId", nom, "createdAt", "updatedAt")
      VALUES ('famille_m', 'eglise_m', 'Famille M', '2026-01-02', now());
    INSERT INTO "CarteFamille" (id, "egliseId", "familleId", token, "emiseLe")
      VALUES ('carte_m', 'eglise_m', 'famille_m', '${JETON_CARTE}', '2026-01-03');
    COMMIT;`);
  return client;
}

/** Applies the lot 1 migration in a transaction, as prisma migrate deploy does. */
async function migrer(client: pg.Client) {
  const script = await sql(LOT1);
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

describe("migration du lot 1 : empreintes des jetons", () => {
  it("convertit les jetons existants, sous RLS forcée, avec la même empreinte que l'application", async () => {
    const client = await baseAvantLot1();
    try {
      await migrer(client);
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.eglise_id', 'eglise_m', true)");
      const { rows: cartes } = await client.query(
        `SELECT "tokenHash", "activeLe" = "emiseLe" AS active FROM "CarteFamille"`,
      );
      const { rows: familles } = await client.query(
        `SELECT "finaliseeLe" = "createdAt" AS finalisee FROM "Famille"`,
      );
      await client.query("COMMIT");
      expect(cartes).toEqual([{ tokenHash: empreinte(JETON_CARTE), active: true }]);
      expect(familles).toEqual([{ finalisee: true }]);

      const { rows: membres } = await client.query(`SELECT "badgeTokenHash" FROM "Membre"`);
      expect(membres).toEqual([{ badgeTokenHash: empreinte(JETON_BADGE) }]);
      expect(await colonnes(client, "CarteFamille")).not.toContain("token");
      expect(await colonnes(client, "Membre")).not.toContain("badgeToken");
    } finally {
      await client.end();
    }
  });

  it("s'interrompt sans rien perdre si une carte n'a pas d'empreinte", async () => {
    const client = await baseAvantLot1();
    try {
      // Sabotage: every update of a card loses its fingerprint.
      await client.query(`
        CREATE FUNCTION sabotage() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN NEW."tokenHash" := NULL; RETURN NEW; END $$;
        CREATE TRIGGER sabotage BEFORE UPDATE ON "CarteFamille"
          FOR EACH ROW EXECUTE FUNCTION sabotage();`);
      await expect(migrer(client)).rejects.toThrow(
        "Migration interrompue : 1 carte(s) sans empreinte valide, jetons conservés.",
      );

      expect(await colonnes(client, "CarteFamille")).toContain("token");
      expect(await colonnes(client, "CarteFamille")).not.toContain("tokenHash");
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.eglise_id', 'eglise_m', true)");
      const { rows } = await client.query(`SELECT token FROM "CarteFamille"`);
      await client.query("COMMIT");
      expect(rows).toEqual([{ token: JETON_CARTE }]);
    } finally {
      await client.end();
    }
  });

  it("s'interrompt sans rien perdre si un badge n'a pas d'empreinte", async () => {
    const client = await baseAvantLot1();
    try {
      await client.query(`
        CREATE FUNCTION sabotage() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN NEW."badgeTokenHash" := NULL; RETURN NEW; END $$;
        CREATE TRIGGER sabotage BEFORE UPDATE ON "Membre"
          FOR EACH ROW EXECUTE FUNCTION sabotage();`);
      await expect(migrer(client)).rejects.toThrow(
        "Migration interrompue : 1 badge(s) sans empreinte valide, jetons conservés.",
      );
      const { rows } = await client.query(`SELECT "badgeToken" FROM "Membre"`);
      expect(rows).toEqual([{ badgeToken: JETON_BADGE }]);
    } finally {
      await client.end();
    }
  });
});

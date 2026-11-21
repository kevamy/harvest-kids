/**
 * The array migration (prisma/migrations/20261115090000_tableaux_non_nuls) makes the only two
 * array columns, Enfant.alertes and Membre.roles, NOT NULL with an empty list by default,
 * after replacing the existing NULLs. Replayed here, file as is, on a throwaway database at
 * the state just before it, with NULLs in two churches (Enfant is under FORCE RLS: the
 * migration must reach every church without lifting it).
 */
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Client,
  PREFIXE_BASE_MIGRATION,
  codeErreur,
  connecter,
  purgerBasesDeMigration,
  supprimerBase,
} from "./support/db";
import { urlsDeTest } from "./support/urls";

const DOSSIER = join(process.cwd(), "prisma", "migrations");
const TABLEAUX = "20261115090000_tableaux_non_nuls";

let proprietaire: Client;
const basesCreees: string[] = [];

const sql = (migration: string) => readFile(join(DOSSIER, migration, "migration.sql"), "utf8");

/** Runs `fn` inside a church (FORCE RLS applies to the owner too). */
async function dansEglise<T>(client: pg.Client, egliseId: string, fn: () => Promise<T>) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.eglise_id', $1, true)", [egliseId]);
    const resultat = await fn();
    await client.query("COMMIT");
    return resultat;
  } catch (erreur) {
    await client.query("ROLLBACK");
    throw erreur;
  }
}

/** New database with every migration before the array one; NULL arrays in two churches. */
async function baseAvantTableaux(): Promise<pg.Client> {
  const nom = `${PREFIXE_BASE_MIGRATION}${randomBytes(4).toString("hex")}`;
  await proprietaire.query(`CREATE DATABASE ${nom}`);
  basesCreees.push(nom);
  const url = new URL(urlsDeTest().migration);
  url.pathname = `/${nom}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();

  const migrations = (await readdir(DOSSIER, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && e.name < TABLEAUX)
    .map((e) => e.name)
    .sort();
  for (const migration of migrations) await client.query(await sql(migration));

  for (const e of ["m", "n"]) {
    await client.query(
      `INSERT INTO "Eglise" (id, nom, slug, "ecranToken", "updatedAt")
       VALUES ($1, $2, $3, $4, now())`,
      [`eglise_${e}`, `Église ${e}`, `eglise-${e}`, `ecran_${e}`],
    );
    await dansEglise(client, `eglise_${e}`, async () => {
      await client.query(
        `INSERT INTO "Famille" (id, "egliseId", nom, "updatedAt") VALUES ($1, $2, 'Famille', now())`,
        [`famille_${e}`, `eglise_${e}`],
      );
      await client.query(
        `INSERT INTO "Enfant" (id, "egliseId", "familleId", prenom, nom, "dateNaissance", alertes, "updatedAt")
         VALUES ($1, $2, $3, 'Sans', 'Alerte', '2020-01-01', NULL, now()),
                ($4, $2, $3, 'Avec', 'Alerte', '2020-01-01', '{ASTHME}', now())`,
        [`sans_${e}`, `eglise_${e}`, `famille_${e}`, `avec_${e}`],
      );
    });
  }
  await client.query(`
    INSERT INTO "User" (id, name, email, "updatedAt")
      VALUES ('user_1', 'Sans rôle', '1@harvest-kids.test', now());
    INSERT INTO "Membre" (id, "egliseId", "userId", roles, "updatedAt")
      VALUES ('membre_1', 'eglise_m', 'user_1', NULL, now());`);
  return client;
}

/** Applies the array migration in a transaction, as prisma migrate deploy does. */
async function migrer(client: pg.Client) {
  const script = await sql(TABLEAUX);
  await client.query("BEGIN");
  try {
    await client.query(script);
    await client.query("COMMIT");
  } catch (erreur) {
    await client.query("ROLLBACK");
    throw erreur;
  }
}

beforeAll(async () => {
  proprietaire = await connecter("proprietaire");
  await purgerBasesDeMigration(proprietaire);
});

afterAll(async () => {
  try {
    for (const nom of basesCreees) await supprimerBase(proprietaire, nom);
  } finally {
    await proprietaire?.end();
  }
});

describe("migration des colonnes tableau", () => {
  it("remplace les NULL par une liste vide dans chaque église, garde les valeurs, puis refuse NULL", async () => {
    const client = await baseAvantTableaux();
    try {
      await migrer(client);

      for (const e of ["m", "n"]) {
        const { rows } = await dansEglise(client, `eglise_${e}`, () =>
          client.query(`SELECT id, alertes FROM "Enfant" WHERE "egliseId" = $1 ORDER BY id`, [
            `eglise_${e}`,
          ]),
        );
        expect(rows).toEqual([
          { id: `avec_${e}`, alertes: ["ASTHME"] },
          { id: `sans_${e}`, alertes: [] },
        ]);
      }
      const membre = await client.query(
        `SELECT roles::text[] AS roles FROM "Membre" WHERE id = 'membre_1'`,
      );
      expect(membre.rows).toEqual([{ roles: [] }]);

      // NULL is refused by the database (23502 not_null_violation); omitted, the list is empty.
      await dansEglise(client, "eglise_m", async () => {
        expect(
          await codeErreur(
            client.query(
              `INSERT INTO "Enfant" (id, "egliseId", "familleId", prenom, nom, "dateNaissance", alertes, "updatedAt")
               VALUES ('nul_m', 'eglise_m', 'famille_m', 'Nul', 'Alerte', '2020-01-01', NULL, now())`,
            ),
          ),
        ).toBe("23502");
      });
      await dansEglise(client, "eglise_m", async () => {
        await client.query(
          `INSERT INTO "Enfant" (id, "egliseId", "familleId", prenom, nom, "dateNaissance", "updatedAt")
           VALUES ('omis_m', 'eglise_m', 'famille_m', 'Omis', 'Alerte', '2020-01-01', now())`,
        );
        const { rows } = await client.query(
          `SELECT alertes FROM "Enfant" WHERE id = 'omis_m' AND "egliseId" = 'eglise_m'`,
        );
        expect(rows).toEqual([{ alertes: [] }]);
      });
      expect(
        await codeErreur(client.query(`UPDATE "Membre" SET roles = NULL WHERE id = 'membre_1'`)),
      ).toBe("23502");
    } finally {
      await client.end();
    }
  });
});

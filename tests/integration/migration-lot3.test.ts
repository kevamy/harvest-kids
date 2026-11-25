/**
 * The lot 3 migration (prisma/migrations/20261124090000_lot3_infirmerie_appels) drops the
 * church's cleartext call screen token and the unused appelParent flag, and adds constraints
 * the existing rows must already respect. Replayed here, file as is, on throwaway databases at
 * the state just before it: once normally, with rows in two churches, then once per guard,
 * sabotaged in the second church, which must abort the migration without changing anything
 * (Presence and Incident are under FORCE RLS: the guards must reach every church).
 */
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Client,
  PREFIXE_BASE_MIGRATION,
  connecter,
  purgerBasesDeMigration,
  supprimerBase,
} from "./support/db";
import { urlsDeTest } from "./support/urls";

const DOSSIER = join(process.cwd(), "prisma", "migrations");
const LOT3 = "20261124090000_lot3_infirmerie_appels";

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

/** New database with every migration before lot 3; a present child and an open incident per church. */
async function baseAvantLot3(): Promise<pg.Client> {
  const nom = `${PREFIXE_BASE_MIGRATION}${randomBytes(4).toString("hex")}`;
  await proprietaire.query(`CREATE DATABASE ${nom}`);
  basesCreees.push(nom);
  const url = new URL(urlsDeTest().migration);
  url.pathname = `/${nom}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();

  const migrations = (await readdir(DOSSIER, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && e.name < LOT3)
    .map((e) => e.name)
    .sort();
  for (const migration of migrations) await client.query(await sql(migration));

  for (const e of ["m", "n"]) {
    const egliseId = `eglise_${e}`;
    await client.query(
      `INSERT INTO "Eglise" (id, nom, slug, "ecranToken", "updatedAt")
       VALUES ($1, $2, $3, $4, now())`,
      [egliseId, `Église ${e}`, `eglise-${e}`, `ecran_${e}`],
    );
    await dansEglise(client, egliseId, async () => {
      await client.query(
        `INSERT INTO "Famille" (id, "egliseId", nom, "updatedAt") VALUES ($1, $2, 'Famille', now())`,
        [`famille_${e}`, egliseId],
      );
      await client.query(
        `INSERT INTO "Enfant" (id, "egliseId", "familleId", prenom, nom, "dateNaissance", "updatedAt")
         VALUES ($1, $2, $3, 'Prénom', 'Nom', '2020-01-01', now())`,
        [`enfant_${e}`, egliseId, `famille_${e}`],
      );
      await client.query(
        `INSERT INTO "Classe" (id, "egliseId", nom, "ageMinMois", "ageMaxMois") VALUES ($1, $2, '3–5 ans', 36, 71)`,
        [`classe_${e}`, egliseId],
      );
      await client.query(
        `INSERT INTO "Session" (id, "egliseId", date, debut, fin)
         VALUES ($1, $2, '2026-11-22', now(), now() + interval '2 hours')`,
        [`session_${e}`, egliseId],
      );
      await client.query(
        `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut, "codeRetrait", "checkinPar", "appelParent")
         VALUES ($1, $2, $3, $4, $5, 'PRESENT', 'K7RM', 'user_1', false)`,
        [`presence_${e}`, egliseId, `session_${e}`, `enfant_${e}`, `classe_${e}`],
      );
      await client.query(
        `INSERT INTO "Incident" (id, "egliseId", "sessionId", type, description, "declarePar")
         VALUES ($1, $2, $3, 'BLESSURE', 'Genou écorché', 'user_1')`,
        [`incident_${e}`, egliseId, `session_${e}`],
      );
    });
  }
  return client;
}

/** Applies the lot 3 migration in a transaction, as prisma migrate deploy does. */
async function migrer(client: pg.Client) {
  const script = await sql(LOT3);
  await client.query("BEGIN");
  try {
    await client.query(script);
    await client.query("COMMIT");
  } catch (erreur) {
    await client.query("ROLLBACK");
    throw erreur;
  }
}

async function colonnes(client: pg.Client, table: string): Promise<string[]> {
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`,
    [table],
  );
  return rows.map((r) => r.column_name);
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

describe("migration du lot 3", () => {
  it("retire le jeton d'écran en clair et le drapeau appelParent, garde les présences et les incidents", async () => {
    const client = await baseAvantLot3();
    try {
      await migrer(client);

      expect(await colonnes(client, "Eglise")).not.toContain("ecranToken");
      const presence = await colonnes(client, "Presence");
      expect(presence).not.toContain("appelParent");
      expect(presence).toEqual(
        expect.arrayContaining(["infirmerieLe", "infirmerieRecueLe", "retourInfirmerieLe"]),
      );
      expect(await colonnes(client, "EcranAppareil")).toContain("appareilHash");
      expect(await colonnes(client, "IncidentNote")).toContain("texte");

      for (const e of ["m", "n"]) {
        const { rows } = await dansEglise(client, `eglise_${e}`, () =>
          client.query(
            `SELECT p.statut::text AS statut, p."infirmerieLe", i."clotureLe", i."cloturePar"
             FROM "Presence" p JOIN "Incident" i ON i."egliseId" = p."egliseId"
             WHERE p."egliseId" = $1`,
            [`eglise_${e}`],
          ),
        );
        expect(rows).toEqual([
          { statut: "PRESENT", infirmerieLe: null, clotureLe: null, cloturePar: null },
        ]);
      }
    } finally {
      await client.end();
    }
  });

  it.each([
    [
      "une présence déjà à l'infirmerie",
      `UPDATE "Presence" SET statut = 'INFIRMERIE' WHERE "egliseId" = 'eglise_n'`,
      "1 présence(s) déjà au statut INFIRMERIE",
    ],
    [
      "deux appels ouverts pour la même présence",
      `INSERT INTO "Appel" (id, "egliseId", "presenceId", motif, lieu, "creePar") VALUES
         ('appel_1', 'eglise_n', 'presence_n', 'pleurs', 'Accueil enfants', 'user_1'),
         ('appel_2', 'eglise_n', 'presence_n', 'pleurs', 'Accueil enfants', 'user_1')`,
      "1 appel(s) de parent contraire(s)",
    ],
    [
      "un appel téléphonique à un numéro hors format",
      `INSERT INTO "AppelTelephonique" (id, "egliseId", "presenceId", "enfantId", numero, canal, "userId")
       VALUES ('tel_1', 'eglise_n', 'presence_n', 'enfant_n', '0197451233', 'tel', 'user_1')`,
      "1 appel(s) téléphonique(s) contraire(s)",
    ],
    [
      "un incident déjà clos",
      `UPDATE "Incident" SET "clotureLe" = now() WHERE "egliseId" = 'eglise_n'`,
      "1 incident(s) clos sans auteur",
    ],
  ])("s'interrompt sans rien changer devant %s", async (_cas, sabotage, message) => {
    const client = await baseAvantLot3();
    try {
      await dansEglise(client, "eglise_n", () => client.query(sabotage));

      await expect(migrer(client)).rejects.toThrow(message);
      // Rolled back as a whole: the old columns are still there, the new table is not.
      expect(await colonnes(client, "Eglise")).toContain("ecranToken");
      expect(await colonnes(client, "Presence")).toContain("appelParent");
      expect(await colonnes(client, "EcranAppareil")).toEqual([]);
    } finally {
      await client.end();
    }
  });
});

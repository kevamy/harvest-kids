import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type Client,
  type Jeu,
  codeErreur,
  connecter,
  creerEglise,
  enEglise,
  viderBase,
} from "./support/db";

// Platform tables are outside RLS; every other table carrying "egliseId" must be isolated.
const TABLES_PLATEFORME = ["Membre", "AccesSupport", "AuditPlateforme"];

let app: Client;
let proprietaire: Client;
let a: Jeu;
let b: Jeu;

beforeAll(async () => {
  app = await connecter("app");
  proprietaire = await connecter("proprietaire");
});

afterAll(async () => {
  await app?.end();
  await proprietaire?.end();
});

beforeEach(async () => {
  await viderBase(proprietaire);
  a = await creerEglise(proprietaire, "a");
  b = await creerEglise(proprietaire, "b");
});

describe("catalogue PostgreSQL", () => {
  it("chaque table d'église a la RLS activée, forcée et sa politique", async () => {
    const { rows } = await proprietaire.query<{
      table: string;
      rls: boolean;
      force: boolean;
      politiques: number;
    }>(`
      SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
             (SELECT count(*)::int FROM pg_policies p
               WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS politiques
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = 'public' AND col.table_name = c.relname
                      AND col.column_name = 'egliseId')
    `);
    const tenant = rows.filter((r) => !TABLES_PLATEFORME.includes(r.table));
    expect(tenant.length).toBe(17);
    for (const table of tenant) {
      expect(table, table.table).toMatchObject({ rls: true, force: true, politiques: 1 });
    }
  });

  it("le rôle applicatif n'est ni superutilisateur, ni BYPASSRLS, ni propriétaire", async () => {
    const { rows } = await proprietaire.query(
      `SELECT rolsuper, rolbypassrls,
              (SELECT count(*)::int FROM pg_tables WHERE tableowner = 'hk_app') AS tables
       FROM pg_roles WHERE rolname = 'hk_app'`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, tables: 0 });
    const { rows: courant } = await app.query("SELECT current_user AS role");
    expect(courant[0].role).toBe("hk_app");
  });
});

describe("Row-Level Security avec le rôle applicatif", () => {
  it("sans église active, aucune ligne n'est visible et aucune écriture n'est possible", async () => {
    const { rows } = await app.query(`SELECT count(*)::int AS n FROM "Enfant"`);
    expect(rows[0].n).toBe(0);
    expect(
      await codeErreur(
        app.query(
          `INSERT INTO "Famille" (id, "egliseId", nom, "updatedAt") VALUES ('f_x', $1, 'X', now())`,
          [a.egliseId],
        ),
      ),
    ).toBe("42501");
  });

  it("le paramètre ne survit pas à la transaction (connexions partagées)", async () => {
    await enEglise(app, a.egliseId, () => app.query("SELECT 1"));
    const { rows } = await app.query(`SELECT count(*)::int AS n FROM "Famille"`);
    expect(rows[0].n).toBe(0);
  });

  it("dans l'église A, seules les données de A sont visibles", async () => {
    const lignes = await enEglise(app, a.egliseId, async () => {
      const familles = await app.query(`SELECT "egliseId" FROM "Famille"`);
      const enfants = await app.query(`SELECT "egliseId" FROM "Enfant"`);
      // Forced query: explicit filter on church B.
      const force = await app.query(`SELECT id FROM "Enfant" WHERE "egliseId" = $1`, [b.egliseId]);
      return { familles: familles.rows, enfants: enfants.rows, force: force.rows };
    });
    expect(lignes.familles).toEqual([{ egliseId: a.egliseId }]);
    expect(lignes.enfants).toEqual([{ egliseId: a.egliseId }]);
    expect(lignes.force).toEqual([]);
  });

  it("dans l'église A, une ligne de B ne peut pas être créée", async () => {
    const code = await codeErreur(
      enEglise(app, a.egliseId, () =>
        app.query(
          `INSERT INTO "Famille" (id, "egliseId", nom, "updatedAt") VALUES ('f_b2', $1, 'Intrus', now())`,
          [b.egliseId],
        ),
      ),
    );
    expect(code).toBe("42501");
  });

  it("dans l'église A, une ligne de B ne peut être ni modifiée, ni supprimée, ni déplacée", async () => {
    const resultats = await enEglise(app, a.egliseId, async () => ({
      modif: await app.query(`UPDATE "Enfant" SET prenom = 'Piraté' WHERE id = $1`, [b.enfantId]),
      suppr: await app.query(`DELETE FROM "Classe" WHERE id = $1`, [b.classeId]),
    }));
    expect(resultats.modif.rowCount).toBe(0);
    expect(resultats.suppr.rowCount).toBe(0);

    // Moving one's own row to church B is refused by WITH CHECK.
    const deplacement = await codeErreur(
      enEglise(app, a.egliseId, () =>
        app.query(`UPDATE "Famille" SET "egliseId" = $1 WHERE id = $2`, [b.egliseId, a.familleId]),
      ),
    );
    expect(deplacement).toBe("42501");

    const intacts = await enEglise(proprietaire, b.egliseId, async () => ({
      enfant: (await proprietaire.query(`SELECT prenom FROM "Enfant" WHERE id = $1`, [b.enfantId]))
        .rows,
      classe: (await proprietaire.query(`SELECT id FROM "Classe" WHERE id = $1`, [b.classeId]))
        .rows,
    }));
    expect(intacts.enfant).toEqual([{ prenom: "Prénom" }]);
    expect(intacts.classe).toEqual([{ id: b.classeId }]);
  });

  it("un enfant de A ne peut pas être rattaché à une famille de B (clé composite)", async () => {
    const code = await codeErreur(
      enEglise(app, a.egliseId, () =>
        app.query(
          `INSERT INTO "Enfant" (id, "egliseId", matricule, "familleId", prenom, nom, "dateNaissance", "updatedAt")
           VALUES ('e_x', $1, 'HK-0002', $2, 'X', 'Y', '2020-01-01', now())`,
          [a.egliseId, b.familleId],
        ),
      ),
    );
    expect(code).toBe("23503");
  });
});

describe("journaux non modifiables (RG-09)", () => {
  it("le journal d'audit et l'historique des présences acceptent l'ajout mais refusent modification et suppression", async () => {
    await enEglise(app, a.egliseId, () =>
      app.query(
        `INSERT INTO "AuditLog" (id, "egliseId", action, entite, "entiteId") VALUES ('log_1', $1, 'test', 'Enfant', $2)`,
        [a.egliseId, a.enfantId],
      ),
    );
    for (const sql of [
      `UPDATE "AuditLog" SET action = 'efface'`,
      `DELETE FROM "AuditLog"`,
      `UPDATE "EvenementPresence" SET type = 'efface'`,
      `DELETE FROM "EvenementPresence"`,
      `DELETE FROM "AuditPlateforme"`,
    ]) {
      expect(await codeErreur(enEglise(app, a.egliseId, () => app.query(sql))), sql).toBe("42501");
    }
  });
});

describe("index partiels", () => {
  const ouvrirPresence = (id: string) =>
    enEglise(app, a.egliseId, () =>
      app.query(
        `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut, "codeRetrait", "checkinPar")
         VALUES ($1, $2, $3, $4, $5, 'PRESENT', 'K7RM', 'user_test')`,
        [id, a.egliseId, a.sessionId, a.enfantId, a.classeId],
      ),
    );

  it("les deux index partiels existent avec leur condition", async () => {
    const { rows } = await proprietaire.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE indexname IN ('Presence_une_ouverte_par_enfant', 'CarteFamille_une_active_par_famille')
       ORDER BY indexname`,
    );
    expect(rows.map((r) => r.indexname)).toEqual([
      "CarteFamille_une_active_par_famille",
      "Presence_une_ouverte_par_enfant",
    ]);
    for (const { indexdef } of rows) expect(indexdef).toMatch(/^CREATE UNIQUE INDEX .* WHERE /);
  });

  it("RG-08 : une seconde présence ouverte pour le même enfant est refusée", async () => {
    await ouvrirPresence("p_1");
    expect(await codeErreur(ouvrirPresence("p_2"))).toBe("23505");

    // Once the child has been picked up, a new presence is accepted.
    await enEglise(app, a.egliseId, () =>
      app.query(`UPDATE "Presence" SET statut = 'RECUPERE' WHERE id = 'p_1'`),
    );
    expect(await codeErreur(ouvrirPresence("p_3"))).toBeUndefined();
  });

  it("une seule carte active par famille ; une carte révoquée libère la place", async () => {
    const emettre = (id: string, token: string) =>
      enEglise(app, a.egliseId, () =>
        app.query(
          `INSERT INTO "CarteFamille" (id, "egliseId", "familleId", token) VALUES ($1, $2, $3, $4)`,
          [id, a.egliseId, a.familleId, token],
        ),
      );
    await emettre("c_1", "HKF1.aaaaaaaaaaaaaaaaaaaaaa");
    expect(await codeErreur(emettre("c_2", "HKF1.bbbbbbbbbbbbbbbbbbbbbb"))).toBe("23505");

    await enEglise(app, a.egliseId, () =>
      app.query(`UPDATE "CarteFamille" SET "revoqueeLe" = now() WHERE id = 'c_1'`),
    );
    expect(await codeErreur(emettre("c_3", "HKF1.cccccccccccccccccccccc"))).toBeUndefined();
  });
});

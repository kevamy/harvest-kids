import { readFile } from "node:fs/promises";
import { getDMMF } from "@prisma/internals";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MODELES_EGLISE } from "@/lib/tenant";
import {
  type Client,
  type Jeu,
  codeErreur,
  connecter,
  creerEglise,
  enEglise,
  viderBase,
} from "./support/db";

// Platform tables (CLAUDE.md) are outside RLS; every other model carrying "egliseId" is a
// church table. The list is read from the Prisma schema (DMMF), so a table added later is
// checked without touching this file.
const TABLES_PLATEFORME = [
  "Eglise",
  "User",
  "Membre",
  "AccesSupport",
  "AuditPlateforme",
  "JetonCompte",
  "AuthSession",
  "AuthAccount",
  "AuthVerification",
  "AuthRateLimit",
];
const { datamodel } = await getDMMF({
  datamodel: await readFile("prisma/schema.prisma", "utf8"),
});
const MODELES = datamodel.models.filter(
  (m) => m.fields.some((f) => f.name === "egliseId") && !TABLES_PLATEFORME.includes(m.name),
);
const TABLES_EGLISE = MODELES.map((m) => m.dbName ?? m.name);

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
  it("le schéma déclare des tables d'église, toutes connues de la barrière applicative", () => {
    expect(TABLES_EGLISE.length).toBeGreaterThan(0);
    // getTenantDb() only reaches the models of MODELES_EGLISE: both lists must agree.
    expect(MODELES.map((m) => m.name).sort()).toEqual([...MODELES_EGLISE].sort());
  });

  it.each(TABLES_EGLISE)(
    "table d'église %s : RLS activée, forcée, avec sa politique tenant_isolation",
    async (table) => {
      const { rows } = await proprietaire.query<{
        rls: boolean;
        force: boolean;
        politiques: number;
      }>(
        `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                (SELECT count(*)::int FROM pg_policies p
                  WHERE p.schemaname = 'public' AND p.tablename = c.relname
                    AND p.policyname = 'tenant_isolation') AS politiques
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
         WHERE c.relkind = 'r' AND c.relname = $1`,
        [table],
      );
      expect(rows, `table ${table} absente de la base`).toHaveLength(1);
      expect(rows[0], `table ${table}`).toEqual({ rls: true, force: true, politiques: 1 });
    },
  );

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
      // An exceptional pickup authorisation is kept as it was given (lot 2).
      `UPDATE "RetraitExceptionnel" SET motif = 'efface'`,
      `DELETE FROM "RetraitExceptionnel"`,
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

  it("les index partiels existent avec leur condition", async () => {
    const { rows } = await proprietaire.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE indexname IN ('Presence_une_ouverte_par_enfant', 'CarteFamille_famille_active',
         'CarteFamille_enfant_active', 'CarteFamille_famille_en_attente', 'CarteFamille_enfant_en_attente',
         'AffectationMoniteur_une_active_par_membre')
       ORDER BY indexname`,
    );
    expect(rows.map((r) => r.indexname)).toEqual([
      "AffectationMoniteur_une_active_par_membre",
      "CarteFamille_enfant_active",
      "CarteFamille_enfant_en_attente",
      "CarteFamille_famille_active",
      "CarteFamille_famille_en_attente",
      "Presence_une_ouverte_par_enfant",
    ]);
    for (const { indexdef } of rows) expect(indexdef).toMatch(/^CREATE UNIQUE INDEX .* WHERE /);
  });

  it("RG-08 : une seconde présence ouverte pour le même enfant est refusée", async () => {
    await ouvrirPresence("p_1");
    expect(await codeErreur(ouvrirPresence("p_2"))).toBe("23505");

    // Once the child has been picked up (by an authorised person, as the base requires since
    // lot 2), a new presence is accepted.
    await enEglise(app, a.egliseId, async () => {
      await app.query(
        `INSERT INTO "PersonneAutorisee" (id, "egliseId", "familleId", prenom, nom, lien, "photoKey")
         VALUES ('pa_1', $1, $2, 'Mireille', 'Adjovi', 'Mère', 'eglises/a/photos/pa.webp')`,
        [a.egliseId, a.familleId],
      );
      await app.query(
        `UPDATE "Presence" SET statut = 'RECUPERE', "recuperePar" = 'pa_1' WHERE id = 'p_1'`,
      );
    });
    expect(await codeErreur(ouvrirPresence("p_3"))).toBeUndefined();
  });

  describe("lot 2 : qui récupère l'enfant, retrait exceptionnel, affectations des moniteurs", () => {
    /** Runs one statement as the application in church A; returns its error code. */
    const executer = (sql: string, valeurs: unknown[] = []) =>
      codeErreur(enEglise(app, a.egliseId, () => app.query(sql, valeurs)));
    const retrait = (id: string, incidentId: string, telephone: string | null) =>
      executer(
        `INSERT INTO "RetraitExceptionnel" (id, "egliseId", "sessionId", "familleId", nom, telephone,
           "photoKey", motif, "autorisePar", "remisPar", "incidentId")
         VALUES ($1, $2, $3, $4, 'Paul Adjovi', $5, 'eglises/a/photos/r.webp',
           'Parents retenus, contact principal joint', 'user_resp', 'user_accueil', $6)`,
        [id, a.egliseId, a.sessionId, a.familleId, telephone, incidentId],
      );
    const affecter = (id: string, sessionClasseId: string) =>
      executer(
        `INSERT INTO "AffectationMoniteur" (id, "egliseId", "sessionClasseId", "membreId")
         VALUES ($1, $2, $3, 'membre_moniteur')`,
        [id, a.egliseId, sessionClasseId],
      );

    beforeEach(async () => {
      // Accounts and member (platform tables), then church A's rows, as the owner.
      await proprietaire.query(
        `INSERT INTO "User" (id, name, email, "updatedAt") VALUES
           ('user_resp', 'Responsable', 'resp@harvest-kids.test', now()),
           ('user_accueil', 'Accueil', 'accueil@harvest-kids.test', now()),
           ('user_moniteur', 'Moniteur', 'moniteur@harvest-kids.test', now())`,
      );
      await proprietaire.query(
        `INSERT INTO "Membre" (id, "egliseId", "userId", roles, "updatedAt")
         VALUES ('membre_moniteur', $1, 'user_moniteur', '{MONITEUR}', now())`,
        [a.egliseId],
      );
      await enEglise(proprietaire, a.egliseId, async () => {
        await proprietaire.query(
          `INSERT INTO "PersonneAutorisee" (id, "egliseId", "familleId", prenom, nom, lien, "photoKey")
           VALUES ('pa_1', $1, $2, 'Mireille', 'Adjovi', 'Mère', 'eglises/a/photos/pa.webp')`,
          [a.egliseId, a.familleId],
        );
        await proprietaire.query(
          `INSERT INTO "Incident" (id, "egliseId", "sessionId", type, description, "declarePar") VALUES
             ('incident_1', $1, $2, 'RETRAIT_NON_AUTORISE', 'Adulte non reconnu', 'user_resp'),
             ('incident_2', $1, $2, 'RETRAIT_NON_AUTORISE', 'Adulte non reconnu', 'user_resp')`,
          [a.egliseId, a.sessionId],
        );
        await proprietaire.query(
          `INSERT INTO "Classe" (id, "egliseId", nom, "ageMinMois", "ageMaxMois")
           VALUES ('classe_a2', $1, '6–8 ans', 72, 107)`,
          [a.egliseId],
        );
        await proprietaire.query(
          `INSERT INTO "SessionClasse" (id, "egliseId", "sessionId", "classeId") VALUES
             ('sc_1', $1, $2, $3), ('sc_2', $1, $2, 'classe_a2')`,
          [a.egliseId, a.sessionId, a.classeId],
        );
      });
      await ouvrirPresence("p_1");
    });

    it("un enfant ne passe à RECUPERE qu'avec une personne autorisée ou un retrait exceptionnel, jamais les deux", async () => {
      expect(await retrait("retrait_1", "incident_1", "+2290197451233")).toBeUndefined();
      // Neither: refused (check_violation).
      expect(await executer(`UPDATE "Presence" SET statut = 'RECUPERE' WHERE id = 'p_1'`)).toBe(
        "23514",
      );
      // Both: refused.
      expect(
        await executer(
          `UPDATE "Presence" SET statut = 'RECUPERE', "recuperePar" = 'pa_1',
             "retraitExceptionnelId" = 'retrait_1' WHERE id = 'p_1'`,
        ),
      ).toBe("23514");
      // Exactly one: accepted, either way.
      expect(
        await executer(
          `UPDATE "Presence" SET statut = 'RECUPERE', "recuperePar" = 'pa_1' WHERE id = 'p_1'`,
        ),
      ).toBeUndefined();
      await ouvrirPresence("p_2");
      expect(
        await executer(
          `UPDATE "Presence" SET statut = 'RECUPERE', "retraitExceptionnelId" = 'retrait_1'
             WHERE id = 'p_2'`,
        ),
      ).toBeUndefined();
    });

    it("le téléphone d'un retrait exceptionnel est facultatif, au format E.164", async () => {
      for (const telephone of ["0197451233", "+229 01 97 45 12 33", "+0197451233"]) {
        expect(await retrait("retrait_x", "incident_1", telephone), telephone).toBe("23514");
      }
      expect(await retrait("retrait_1", "incident_1", null)).toBeUndefined();
      // One pickup per incident.
      expect(await retrait("retrait_2", "incident_1", "+2290197451233")).toBe("23505");
      expect(await retrait("retrait_2", "incident_2", "+2290197451233")).toBeUndefined();
    });

    it("isolation A/B : un retrait exceptionnel de A est invisible depuis B", async () => {
      await retrait("retrait_1", "incident_1", null);
      const { rows } = await enEglise(app, b.egliseId, () =>
        app.query(`SELECT id FROM "RetraitExceptionnel"`),
      );
      expect(rows).toEqual([]);
    });

    it("un moniteur n'a qu'une affectation active à la fois", async () => {
      expect(await affecter("aff_1", "sc_1")).toBeUndefined();
      expect(await affecter("aff_2", "sc_2")).toBe("23505");
      expect(
        await executer(`UPDATE "AffectationMoniteur" SET depart = now() WHERE id = 'aff_1'`),
      ).toBeUndefined();
      expect(await affecter("aff_2", "sc_2")).toBeUndefined();
    });
  });

  describe("cartes (RG-16) : une active et une en attente au plus par couverture", () => {
    const emettre = (id: string, options: { enfantId?: string; active: boolean }) =>
      enEglise(app, a.egliseId, () =>
        app.query(
          `INSERT INTO "CarteFamille" (id, "egliseId", "familleId", "enfantId", "tokenHash", "activeLe")
           VALUES ($1, $2, $3, $4, md5($1) || md5($1), CASE WHEN $5 THEN now() END)`,
          [id, a.egliseId, a.familleId, options.enfantId ?? null, options.active],
        ),
      );
    const revoquer = (id: string) =>
      enEglise(app, a.egliseId, () =>
        app.query(`UPDATE "CarteFamille" SET "revoqueeLe" = now() WHERE id = $1`, [id]),
      );

    it("carte famille : une seconde active ou une seconde en attente est refusée", async () => {
      await emettre("f_actif", { active: true });
      expect(await codeErreur(emettre("f_actif_2", { active: true }))).toBe("23505");
      await emettre("f_attente", { active: false });
      expect(await codeErreur(emettre("f_attente_2", { active: false }))).toBe("23505");

      // A revoked card frees its place.
      await revoquer("f_actif");
      expect(await codeErreur(emettre("f_actif_3", { active: true }))).toBeUndefined();
    });

    it("carte enfant : une seconde active ou une seconde en attente est refusée", async () => {
      const enfant = { enfantId: a.enfantId };
      await emettre("e_actif", { ...enfant, active: true });
      expect(await codeErreur(emettre("e_actif_2", { ...enfant, active: true }))).toBe("23505");
      await emettre("e_attente", { ...enfant, active: false });
      expect(await codeErreur(emettre("e_attente_2", { ...enfant, active: false }))).toBe("23505");
    });

    it("une carte famille et une carte enfant peuvent coexister pendant une transition", async () => {
      await emettre("f", { active: true });
      expect(
        await codeErreur(emettre("e", { enfantId: a.enfantId, active: false })),
      ).toBeUndefined();
    });

    it("une carte enfant ne peut désigner qu'un enfant de sa famille", async () => {
      await enEglise(proprietaire, a.egliseId, () =>
        proprietaire.query(
          `INSERT INTO "Famille" (id, "egliseId", nom, "finaliseeLe", "updatedAt")
           VALUES ('famille_a_2', $1, 'Autre', now(), now())`,
          [a.egliseId],
        ),
      );
      const code = await codeErreur(
        enEglise(app, a.egliseId, () =>
          app.query(
            `INSERT INTO "CarteFamille" (id, "egliseId", "familleId", "enfantId", "tokenHash")
             VALUES ('x', $1, 'famille_a_2', $2, md5('x') || md5('x'))`,
            [a.egliseId, a.enfantId],
          ),
        ),
      );
      expect(code).toBe("23503");
    });
  });
});

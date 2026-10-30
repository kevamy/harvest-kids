/**
 * RG-14: hk_jeton_autre_eglise() tells whether a token fingerprint exists in another
 * church, and nothing else. It runs as the owner (SECURITY DEFINER) to see past
 * Row-Level Security, so these tests pin down everything it could leak.
 */
import { createHash } from "node:crypto";
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

let app: Client;
let proprietaire: Client;
let a: Jeu;
let b: Jeu;

const empreinte = (jeton: string) => createHash("sha256").update(jeton, "utf8").digest("hex");
const CARTE_A = "HKF1.AAAAAAAAAAAAAAAAAAAAAA";
const CARTE_B = "HKF1.BBBBBBBBBBBBBBBBBBBBBB";
const CARTE_B_REVOQUEE = "HKF1.RRRRRRRRRRRRRRRRRRRRRR";
const BADGE_B = "HKB1.BBBBBBBBBBBBBBBBBBBBBB";
const INCONNU = "HKF1.ZZZZZZZZZZZZZZZZZZZZZZ";

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
  const carte = (jeu: Jeu, id: string, jeton: string, revoquee = false) =>
    enEglise(proprietaire, jeu.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "CarteFamille" (id, "egliseId", "familleId", "tokenHash", "activeLe", "revoqueeLe")
         VALUES ($1, $2, $3, $4, now(), CASE WHEN $5 THEN now() END)`,
        [id, jeu.egliseId, jeu.familleId, empreinte(jeton), revoquee],
      ),
    );
  await carte(a, "carte_a", CARTE_A);
  await carte(b, "carte_b", CARTE_B);
  await carte(b, "carte_b_revoquee", CARTE_B_REVOQUEE, true);
  await proprietaire.query(
    `INSERT INTO "User" (id, name, email, "updatedAt") VALUES ('user_b', 'B', 'b@harvest-kids.test', now())`,
  );
  await proprietaire.query(
    `INSERT INTO "Membre" (id, "egliseId", "userId", roles, "badgeTokenHash", "updatedAt")
     VALUES ('membre_b', $1, 'user_b', '{MONITEUR}', $2, now())`,
    [b.egliseId, empreinte(BADGE_B)],
  );
});

/** Calls the function as hk_app, inside a church (or without one). */
async function autreEglise(valeur: string | null, egliseId: string | null = a.egliseId) {
  const appel = () =>
    app.query<{ autre: unknown }>("SELECT hk_jeton_autre_eglise($1) AS autre", [valeur]);
  const { rows } = egliseId ? await enEglise(app, egliseId, appel) : await appel();
  return rows;
}

describe("RG-14 : hk_jeton_autre_eglise()", () => {
  it("est déclarée SECURITY DEFINER, avec un search_path fixé, et ne renvoie qu'un booléen", async () => {
    const { rows } = await proprietaire.query(`
      SELECT p.prosecdef AS definer, p.proconfig AS config, p.proretset AS ensemble,
             format_type(p.prorettype, NULL) AS retour, p.pronargs AS nombre_args,
             pg_get_function_arguments(p.oid) AS arguments,
             pg_get_function_result(p.oid) AS resultat,
             p.proargmodes AS modes, p.provolatile AS volatilite,
             pg_get_userbyid(p.proowner) = current_user AS appartient_au_proprietaire
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
      WHERE p.proname = 'hk_jeton_autre_eglise'`);
    expect(rows).toEqual([
      {
        definer: true,
        config: ["search_path=public, pg_temp"],
        ensemble: false,
        retour: "boolean",
        nombre_args: 1,
        arguments: "p_empreinte text",
        resultat: "boolean",
        modes: null, // IN arguments only: no OUT or INOUT parameter
        volatilite: "s",
        appartient_au_proprietaire: true,
      },
    ]);
  });

  it("n'est exécutable que par hk_app et le propriétaire, jamais par PUBLIC", async () => {
    const { rows } = await proprietaire.query(`
      SELECT a.grantee::regrole::text AS role, a.privilege_type AS droit
      FROM pg_proc p, aclexplode(p.proacl) a
      WHERE p.proname = 'hk_jeton_autre_eglise'
      ORDER BY 1`);
    const roles = rows.map((r) => r.role).sort();
    const { rows: courant } = await proprietaire.query("SELECT current_user AS role");
    expect(roles).toEqual([courant[0].role, "hk_app"].sort());
    expect(rows.every((r) => r.droit === "EXECUTE")).toBe(true);
    // grantee 0 is PUBLIC: absent from the ACL.
    const { rows: publics } = await proprietaire.query(`
      SELECT count(*)::int AS n FROM pg_proc p, aclexplode(p.proacl) a
      WHERE p.proname = 'hk_jeton_autre_eglise' AND a.grantee = 0`);
    expect(publics[0].n).toBe(0);
  });

  it("la seule politique hors tenant_isolation est la lecture propriétaire de CarteFamille", async () => {
    const { rows } = await proprietaire.query(`
      SELECT tablename, policyname, cmd, roles::text[] AS roles, permissive, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public' AND policyname <> 'tenant_isolation'`);
    const { rows: courant } = await proprietaire.query("SELECT current_user AS role");
    expect(rows).toEqual([
      {
        tablename: "CarteFamille",
        policyname: "rg14_lecture_proprietaire",
        cmd: "SELECT", // read only: no INSERT, UPDATE or DELETE
        roles: [courant[0].role],
        permissive: "PERMISSIVE",
        qual: "true",
        with_check: null,
      },
    ]);
  });

  it("répond vrai pour une carte ou un badge d'une autre église, même révoquée", async () => {
    expect(await autreEglise(empreinte(CARTE_B))).toEqual([{ autre: true }]);
    expect(await autreEglise(empreinte(CARTE_B_REVOQUEE))).toEqual([{ autre: true }]);
    expect(await autreEglise(empreinte(BADGE_B))).toEqual([{ autre: true }]);
    // Seen from church B, church A's card is the foreign one.
    expect(await autreEglise(empreinte(CARTE_A), b.egliseId)).toEqual([{ autre: true }]);
  });

  it("répond faux pour une carte de l'église active, un jeton inconnu ou une valeur mal formée", async () => {
    expect(await autreEglise(empreinte(CARTE_A))).toEqual([{ autre: false }]);
    expect(await autreEglise(empreinte(INCONNU))).toEqual([{ autre: false }]);
    // The clear token, an uppercase fingerprint, a pattern, NULL: never a match.
    expect(await autreEglise(CARTE_B)).toEqual([{ autre: false }]);
    expect(await autreEglise(empreinte(CARTE_B).toUpperCase())).toEqual([{ autre: false }]);
    expect(await autreEglise("%")).toEqual([{ autre: false }]);
    expect(await autreEglise(null)).toEqual([{ autre: false }]);
  });

  it("répond faux sans église active", async () => {
    expect(await autreEglise(empreinte(CARTE_B), null)).toEqual([{ autre: false }]);
  });

  it("ne rend rien d'autre lisible : les lignes de B restent invisibles pour hk_app", async () => {
    await enEglise(app, a.egliseId, async () => {
      await app.query("SELECT hk_jeton_autre_eglise($1)", [empreinte(CARTE_B)]);
      const { rows } = await app.query(
        `SELECT count(*)::int AS n FROM "CarteFamille" WHERE "egliseId" = $1`,
        [b.egliseId],
      );
      expect(rows[0].n).toBe(0);
    });
    // The owner-only reading policy does not apply to hk_app.
    const { rows } = await proprietaire.query(
      `SELECT pg_has_role('hk_app', current_user, 'MEMBER') AS membre`,
    );
    expect(rows[0].membre).toBe(false);
  });

  it("une table piégée dans pg_temp ne change pas le résultat (search_path fixé)", async () => {
    await enEglise(app, a.egliseId, async () => {
      await app.query(`CREATE TEMP TABLE "CarteFamille" ("tokenHash" text, "egliseId" text)`);
      await app.query(`INSERT INTO pg_temp."CarteFamille" VALUES ($1, 'eglise_piege')`, [
        empreinte(INCONNU),
      ]);
      const { rows } = await app.query("SELECT hk_jeton_autre_eglise($1) AS autre", [
        empreinte(INCONNU),
      ]);
      expect(rows).toEqual([{ autre: false }]);
      await app.query(`DROP TABLE pg_temp."CarteFamille"`);
    });
  });

  it("hk_app ne peut ni la remplacer ni en changer le propriétaire", async () => {
    expect(
      await codeErreur(
        app.query(`CREATE OR REPLACE FUNCTION public.hk_jeton_autre_eglise(p_empreinte text)
                   RETURNS boolean LANGUAGE sql AS $$ SELECT true $$`),
      ),
    ).toBe("42501");
  });
});

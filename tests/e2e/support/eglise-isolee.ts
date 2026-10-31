import { randomBytes, randomInt } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { test as base } from "@playwright/test";
import type pg from "pg";
import { avecBase, email } from "./base";

/**
 * A church created for one test, with its accounts and data, and deleted with all of them
 * afterwards. Tests that write (families, cards, settings, logos, PIN) work in such a
 * church: the demonstration churches are never changed (checked by garde-demo.ts).
 */

const ROLES = ["ADMIN", "RESPONSABLE", "ACCUEIL", "MONITEUR", "INFIRMERIE"] as const;
type Role = (typeof ROLES)[number];

// Same defaults as a church created by the platform (src/server/plateforme/eglises.ts).
const CLASSES = [
  ["Pouponnière", 0, 35, 1],
  ["3–5 ans", 36, 71, 2],
  ["6–8 ans", 72, 107, 3],
  ["9–12 ans", 108, 155, 4],
] as const;
const CULTES = [
  ["Culte 1", 0, "08:00", "10:00"],
  ["Culte 2", 0, "10:30", "12:30"],
] as const;

export type EgliseIsolee = {
  id: string;
  nom: string;
  slug: string;
  /** Sign-in address of the church's account for a role (demonstration password and PIN). */
  email(role: Role): string;
  /** Runs SQL inside the church, as the owner, in one transaction (FORCE RLS applies). */
  dansEglise<T>(fn: (c: pg.Client) => Promise<T>): Promise<T>;
  /** A finalised family with its children (matricules HK-0001…) and no card. */
  creerFamille(nom: string, prenoms: string[]): Promise<{ familleId: string; enfantIds: string[] }>;
};

async function dansEglise<T>(egliseId: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  return avecBase(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query("SELECT set_config('app.eglise_id', $1, true)", [egliseId]);
      const resultat = await fn(c);
      await c.query("COMMIT");
      return resultat;
    } catch (erreur) {
      await c.query("ROLLBACK");
      throw erreur;
    }
  });
}

export async function creerEgliseIsolee(libelle: string): Promise<EgliseIsolee> {
  const suffixe = randomBytes(5).toString("hex");
  const id = `e2e_${suffixe}`;
  const slug = `e2e-${suffixe}`;
  const nom = `Église de test ${libelle} ${suffixe}`;
  const adresse = (role: Role) => `${role.toLowerCase()}.${slug}@e2e.harvest-kids.test`;

  await avecBase(async (c) => {
    // Same password and PIN as the demonstration accounts: their hashes are reused.
    const { rows } = await c.query<{ password: string; pinHash: string }>(
      `SELECT a.password, m."pinHash" FROM "User" u
       JOIN "AuthAccount" a ON a."userId" = u.id AND a."providerId" = 'credential'
       JOIN "Membre" m ON m."userId" = u.id
       WHERE u.email = $1 LIMIT 1`,
      [email("admin", "cotonou")],
    );
    const secrets = rows[0];
    if (!secrets) throw new Error("Comptes de démonstration absents : lancez `pnpm db:seed`.");

    await c.query("BEGIN");
    await c.query(
      `INSERT INTO "Eglise" (id, nom, slug, "ecranToken", "updatedAt") VALUES ($1, $2, $3, $4, now())`,
      [id, nom, slug, `ecran_${randomBytes(16).toString("hex")}`],
    );
    for (const role of ROLES) {
      const userId = `${id}_${role.toLowerCase()}`;
      await c.query(
        `INSERT INTO "User" (id, name, email, "updatedAt") VALUES ($1, $2, $3, now())`,
        [userId, `${role[0]}${role.slice(1).toLowerCase()} test`, adresse(role)],
      );
      await c.query(
        `INSERT INTO "AuthAccount" (id, "accountId", "providerId", "userId", password, "updatedAt")
         VALUES ($1, $2, 'credential', $2, $3, now())`,
        [`${userId}_compte`, userId, secrets.password],
      );
      await c.query(
        `INSERT INTO "Membre" (id, "egliseId", "userId", roles, "pinHash", "updatedAt")
         VALUES ($1, $2, $3, $4::"Role"[], $5, now())`,
        [`${userId}_membre`, id, userId, [role], secrets.pinHash],
      );
    }
    await c.query("SELECT set_config('app.eglise_id', $1, true)", [id]);
    for (const [nomClasse, min, max, ordre] of CLASSES) {
      await c.query(
        `INSERT INTO "Classe" (id, "egliseId", nom, "ageMinMois", "ageMaxMois", ordre)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [`${id}_classe_${ordre}`, id, nomClasse, min, max, ordre],
      );
    }
    for (const [i, [nomCulte, jour, debut, fin]] of CULTES.entries()) {
      await c.query(
        `INSERT INTO "Culte" (id, "egliseId", nom, jour, "heureDebut", "heureFin")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [`${id}_culte_${i}`, id, nomCulte, jour, debut, fin],
      );
    }
    await c.query("COMMIT");
  });

  let matricule = 0;
  return {
    id,
    nom,
    slug,
    email: adresse,
    dansEglise: (fn) => dansEglise(id, fn),
    creerFamille: (nomFamille, prenoms) =>
      dansEglise(id, async (c) => {
        const familleId = `${id}_famille_${randomInt(1e9)}`;
        await c.query(
          `INSERT INTO "Famille" (id, "egliseId", nom, "consentementDonnees", "finaliseeLe", "updatedAt")
           VALUES ($1, $2, $3, now(), now(), now())`,
          [familleId, id, nomFamille],
        );
        const enfantIds: string[] = [];
        for (const [i, prenom] of prenoms.entries()) {
          const enfantId = `${familleId}_${i}`;
          matricule++;
          await c.query(
            `INSERT INTO "Enfant" (id, "egliseId", matricule, "familleId", prenom, nom, "dateNaissance", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
            [
              enfantId,
              id,
              `HK-${String(matricule).padStart(4, "0")}`,
              familleId,
              prenom,
              nomFamille,
              `${2018 + i}-01-01`,
            ],
          );
          enfantIds.push(enfantId);
        }
        // Next matricule of the church (RG-01), as the application would have left it.
        await c.query(`UPDATE "Eglise" SET "prochainMatricule" = $2 WHERE id = $1`, [
          id,
          matricule + 1,
        ]);
        return { familleId, enfantIds };
      }),
  };
}

/** Church tables (with `egliseId`), children before parents: the deletion order. */
async function ordreDeSuppression(c: pg.Client): Promise<string[]> {
  const tables = (
    await c.query<{ t: string }>(
      `SELECT c.relname AS t FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attname = 'egliseId' AND NOT a.attisdropped`,
    )
  ).rows.map((r) => r.t);
  const liens = (
    await c.query<{ enfant: string; parent: string }>(
      `SELECT e.relname AS enfant, p.relname AS parent FROM pg_constraint k
       JOIN pg_class e ON e.oid = k.conrelid
       JOIN pg_class p ON p.oid = k.confrelid
       WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace`,
    )
  ).rows.filter((l) => l.enfant !== l.parent);

  const restantes = new Set(tables);
  const ordre: string[] = [];
  while (restantes.size > 0) {
    // A table can go once no remaining table references it.
    const libres = [...restantes].filter(
      (t) => !liens.some((l) => l.parent === t && restantes.has(l.enfant)),
    );
    if (libres.length === 0) throw new Error(`Cycle de clés étrangères : ${[...restantes]}`);
    for (const t of libres) {
      ordre.push(t);
      restantes.delete(t);
    }
  }
  return ordre;
}

/** Deletes the church, every row of it, its accounts and its files. */
export async function supprimerEgliseIsolee(eglise: Pick<EgliseIsolee, "id" | "slug">) {
  await avecBase(async (c) => {
    const ordre = await ordreDeSuppression(c);
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.eglise_id', $1, true)", [eglise.id]);
    for (const table of ordre) {
      await c.query(`DELETE FROM "${table}" WHERE "egliseId" = $1`, [eglise.id]);
    }
    await c.query(`DELETE FROM "Eglise" WHERE id = $1`, [eglise.id]);
    await c.query(`DELETE FROM "User" WHERE email LIKE $1`, [
      `%.${eglise.slug}@e2e.harvest-kids.test`,
    ]);
    await c.query("COMMIT");
  });
  // Local storage (e2e): files live under eglises/{egliseId}/.
  if ((process.env.STORAGE_DRIVER ?? "local") === "local") {
    const racine = resolve(process.cwd(), process.env.UPLOADS_DIR || "./uploads");
    await rm(resolve(racine, "eglises", eglise.id), { recursive: true, force: true });
  }
}

/**
 * `eglise` and `autreEglise`: churches created for the test that asks for them, deleted
 * after it whatever its outcome.
 */
export const test = base.extend<{ eglise: EgliseIsolee; autreEglise: EgliseIsolee }>({
  // `fournir`: Playwright's `use` (renamed: not a React hook).
  eglise: async ({}, fournir) => {
    const eglise = await creerEgliseIsolee("A");
    try {
      await fournir(eglise);
    } finally {
      await supprimerEgliseIsolee(eglise);
    }
  },
  autreEglise: async ({}, fournir) => {
    const eglise = await creerEgliseIsolee("B");
    try {
      await fournir(eglise);
    } finally {
      await supprimerEgliseIsolee(eglise);
    }
  },
});

export { expect } from "@playwright/test";

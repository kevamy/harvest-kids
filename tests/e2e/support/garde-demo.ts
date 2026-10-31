import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { avecBase } from "./base";

/**
 * Guard of the demonstration data (global setup of the e2e suite): a fingerprint of the
 * demonstration churches is taken before the suite and compared after it. Any lasting
 * change fails the run, naming the table. Tests that write work in a church created for
 * them (eglise-isolee.ts).
 *
 * Covered: the churches' rows, every church table (`egliseId`), members, accounts and
 * credentials of their users, and their stored files. Not covered: sign-in sessions and
 * throttling counters (AuthSession, AuthRateLimit, AuthVerification), which each sign-in
 * creates by design.
 */
const SLUGS = ["demo-cotonou", "demo-porto-novo"];

async function fichiers(dossier: string): Promise<string[]> {
  const entrees = await readdir(dossier, { withFileTypes: true }).catch(() => []);
  const liste: string[] = [];
  for (const e of entrees) {
    const chemin = join(dossier, e.name);
    if (e.isDirectory()) liste.push(...(await fichiers(chemin)));
    else liste.push(`${chemin} ${(await stat(chemin)).size}`);
  }
  return liste.sort();
}

async function empreinte(): Promise<Map<string, string>> {
  const resultat = new Map<string, string>();
  await avecBase(async (c) => {
    const tables = (
      await c.query<{ t: string }>(
        `SELECT c.relname AS t FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attname = 'egliseId'
           AND NOT a.attisdropped
         ORDER BY 1`,
      )
    ).rows.map((r) => r.t);
    const eglises = (
      await c.query<{ id: string; slug: string; ligne: string }>(
        `SELECT id, slug, e::text AS ligne FROM "Eglise" e WHERE slug = ANY($1) ORDER BY slug`,
        [SLUGS],
      )
    ).rows;
    if (eglises.length !== SLUGS.length) {
      throw new Error("Églises de démonstration absentes : lancez `pnpm db:seed`.");
    }

    for (const eglise of eglises) {
      resultat.set(`Eglise ${eglise.slug}`, eglise.ligne);
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.eglise_id', $1, true)", [eglise.id]);
      for (const table of tables) {
        const { rows } = await c.query<{ n: number; h: string }>(
          `SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, E'\\n' ORDER BY x::text), '')) AS h
           FROM "${table}" x WHERE "egliseId" = $1`,
          [eglise.id],
        );
        resultat.set(`${table} ${eglise.slug}`, `${rows[0]!.n} ligne(s), ${rows[0]!.h}`);
      }
      await c.query("COMMIT");
      const racine = resolve(process.cwd(), process.env.UPLOADS_DIR || "./uploads");
      const liste = await fichiers(join(racine, "eglises", eglise.id));
      resultat.set(`fichiers ${eglise.slug}`, `${liste.length} fichier(s) : ${liste.join(", ")}`);
    }

    // Accounts of the demonstration members and their credentials.
    const ids = eglises.map((e) => e.id);
    for (const [table, colonne] of [
      ["User", "id"],
      ["AuthAccount", "userId"],
    ] as const) {
      const { rows } = await c.query<{ l: string }>(
        `SELECT x::text AS l FROM "${table}" x
         WHERE "${colonne}" IN (SELECT "userId" FROM "Membre" WHERE "egliseId" = ANY($1))
         ORDER BY 1`,
        [ids],
      );
      resultat.set(table, `${rows.length} ligne(s), ${rows.map((r) => r.l).join("\n")}`);
    }
  });
  return resultat;
}

export default async function gardeDemo() {
  const avant = await empreinte();
  return async () => {
    const apres = await empreinte();
    const modifiees = [...new Set([...avant.keys(), ...apres.keys()])].filter(
      (cle) => avant.get(cle) !== apres.get(cle),
    );
    if (modifiees.length > 0) {
      const extrait = (valeur: string | undefined) => valeur?.slice(0, 80) ?? "absent";
      const lignes = modifiees.map(
        (cle) => `- ${cle} : avant ${extrait(avant.get(cle))} ; après ${extrait(apres.get(cle))}`,
      );
      throw new Error(
        [
          "Les tests e2e ont modifié durablement les données de démonstration :",
          ...lignes,
          "Un test qui écrit doit travailler dans une église isolée (support/eglise-isolee.ts).",
        ].join("\n"),
      );
    }
  };
}

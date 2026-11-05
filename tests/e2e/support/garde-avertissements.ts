import { readFile } from "node:fs/promises";

/**
 * Global teardown of the e2e suite: fails the run if the web server warned about
 * concurrent queries on one pg connection (marked by garde-avertissements-serveur.cjs in
 * the server log that scripts/serveur-e2e.mjs keeps). Without that log (local dev server
 * reused), there is nothing to check.
 */
export default async function gardeAvertissements() {
  const journal = process.env.HK_JOURNAL_SERVEUR;
  if (!journal) return;
  const contenu = await readFile(journal, "utf8").catch(() => "");
  const lignes = contenu.split("\n").filter((l) => l.includes("HK-GARDE-PG"));
  if (lignes.length > 0) {
    throw new Error(
      [
        "Le serveur a envoyé des requêtes pg simultanées sur une même connexion (refusées par pg 9) :",
        ...lignes,
        `Pile complète dans ${journal}.`,
      ].join("\n"),
    );
  }
}

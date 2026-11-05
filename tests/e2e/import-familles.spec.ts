import type { Page } from "@playwright/test";
import { attendreAccueil, reinitialiserLimites, seConnecter } from "./support/base";
import { expect, test } from "./support/eglise-isolee";

/**
 * Family import (ADR 0013): template, preview, import as drafts, then finalisation at the
 * reception desk, matricules and card. In a church created for the test.
 */

test.beforeEach(reinitialiserLimites);

// A valid 4 × 4 PNG made by sharp, small enough to inline.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWM4YKn9HxkzkC4AAIVoIjHsbvoAAAAAAElFTkSuQmCC",
  "base64",
);

// Excel's "CSV" on a French Windows: Windows-1252 (accents as single bytes, "œ" is 0x9C).
const enWindows1252 = (texte: string) =>
  Buffer.from([...texte].map((c) => (c === "œ" ? 0x9c : c.charCodeAt(0))));

const FICHIER = enWindows1252(
  [
    "Nom de famille;Prénom de l'enfant;Nom de l'enfant;Date de naissance;Sexe;Prénom tuteur 1;Nom tuteur 1;Lien tuteur 1;Téléphone tuteur 1",
    "Ahouansou;Grâce;Ahouansou;14/03/2019;F;Rachel;Ahouansou;Mère;97 45 12 33",
    "Ahouansou;Daniel;Ahouansou;2/9/2021;M;Rachel;Ahouansou;Mère;97 45 12 33",
    "Dossou;Ayo;Dossou;1/2/2020;;Lœtitia;Dossou;Tante;numéro inconnu",
    "Dossou;Koffi;Dossou;05/03/19;;Lœtitia;Dossou;Tante;numéro inconnu",
  ].join("\r\n"),
);

async function telecharger(page: Page, declencheur: () => Promise<void>) {
  const [telechargement] = await Promise.all([page.waitForEvent("download"), declencheur()]);
  const flux = await telechargement.createReadStream();
  const morceaux: Buffer[] = [];
  for await (const m of flux) morceaux.push(m as Buffer);
  return { nom: telechargement.suggestedFilename(), contenu: Buffer.concat(morceaux) };
}

test("le responsable importe des familles, puis l'accueil finalise une famille et imprime sa carte", async ({
  page,
  eglise,
}) => {
  await seConnecter(page, eglise.email("RESPONSABLE"));
  await attendreAccueil(page, eglise.nom);
  await page.getByRole("link", { name: "Familles" }).click();
  await page.getByRole("link", { name: "Importer des familles" }).click();
  await expect(
    page.getByRole("heading", { name: "Importer des familles", level: 1 }),
  ).toBeVisible();

  const modele = await telecharger(page, () =>
    page.getByRole("link", { name: "Télécharger le modèle" }).click(),
  );
  expect(modele.nom).toBe("modele-import-familles.csv");
  expect(modele.contenu.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(modele.contenu.toString("utf8")).toContain("Nom de famille;Prénom de l'enfant;");

  await page.getByLabel("Fichier CSV").setInputFiles({
    name: "familles.csv",
    mimeType: "text/csv",
    buffer: FICHIER,
  });
  await page.getByRole("button", { name: "Analyser le fichier" }).click();
  await expect(page.getByTestId("import-resume")).toHaveText(
    "4 ligne(s) lue(s) : 2 famille(s) prête(s), 0 doublon(s) possible(s), 1 ligne(s) rejetée(s).",
  );
  await expect(page.getByText("Encodage Windows-1252, séparateur « point-virgule »")).toBeVisible();
  const rejets = page.getByRole("region", { name: "Lignes rejetées" });
  await expect(rejets).toContainText("Ligne 5 : Date de naissance « 05/03/19 »");
  await expect(rejets).toContainText("saisissez l'année complète");
  const pretes = page.getByRole("region", { name: "Familles prêtes à importer" });
  await expect(pretes).toContainText("Lœtitia Dossou (Tante)");
  await expect(pretes).toContainText(
    "Tuteur 1 : numéro illisible (« numéro inconnu »), à corriger à la finalisation.",
  );

  const corrections = page.getByRole("region", { name: "Numéros à confirmer" });
  await expect(corrections).toContainText("« 97 45 12 33 » devient 01 97 45 12 33");
  await corrections.getByRole("button", { name: "Valider toutes les corrections" }).click();
  await expect(corrections.getByRole("checkbox")).toBeChecked();

  await page.getByRole("button", { name: "Importer 2 familles" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Familles importées : 2. Elles sont dans la liste « À compléter ».",
  );
  await page.getByRole("link", { name: "Voir les familles à compléter" }).click();
  const aCompleter = page.getByRole("region", { name: "Familles à compléter" });
  await expect(aCompleter.getByRole("link")).toHaveCount(2);

  // The reception desk finalises the draft: phone already confirmed, photo and consent.
  await page.context().clearCookies();
  await seConnecter(page, eglise.email("ACCUEIL"));
  await attendreAccueil(page, eglise.nom);
  await page.goto("/familles");
  await page
    .getByRole("region", { name: "Familles à compléter" })
    .getByRole("link", { name: /Famille Ahouansou/ })
    .click();
  await page.getByRole("link", { name: "Finaliser l'inscription" }).click();
  await expect(page.getByLabel("Téléphone du tuteur 1", { exact: true })).toHaveValue(
    "+229 01 97 45 12 33",
  );
  await page.getByLabel("Photo du tuteur 1", { exact: true }).setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByRole("img", { name: "Photo du tuteur 1" })).toBeVisible();
  await page.getByLabel(/J'accepte que les données de mes enfants/).check();
  await page.getByRole("button", { name: "Finaliser l'inscription" }).click();

  await expect(page).toHaveURL(/\/familles\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Famille Ahouansou", level: 1 })).toBeVisible();
  const enfants = page.locator("section", {
    has: page.getByRole("heading", { name: "Enfants", level: 2 }),
  });
  for (const matricule of ["HK-0001", "HK-0002"]) {
    await expect(enfants.getByText(matricule, { exact: true })).toBeVisible();
  }
  const carte = await telecharger(page, () =>
    page.getByRole("button", { name: "Imprimer la carte" }).click(),
  );
  expect(carte.contenu.subarray(0, 5).toString()).toBe("%PDF-");
});

test("l'accueil n'importe pas de familles", async ({ page, eglise }) => {
  await seConnecter(page, eglise.email("ACCUEIL"));
  await attendreAccueil(page, eglise.nom);
  await page.goto("/familles");
  await expect(page.getByRole("heading", { name: "Familles", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Importer des familles" })).toHaveCount(0);
  expect((await page.goto("/familles/importer"))?.status()).toBe(404);
  expect((await page.request.get("/api/familles/modele-import")).status()).toBe(404);
});

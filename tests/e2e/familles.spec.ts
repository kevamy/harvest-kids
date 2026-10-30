import { expect, test, type Page } from "@playwright/test";
import {
  EGLISES,
  attendreAccueil,
  avecBase,
  egliseDuProjet,
  email,
  reinitialiserLimites,
  seConnecter,
} from "./support/base";

const PREFIXE = "E2E";
// A valid 4 × 4 PNG made by sharp, small enough to inline.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWM4YKn9HxkzkC4AAIVoIjHsbvoAAAAAAElFTkSuQmCC",
  "base64",
);

/** Removes the families created by these tests only (owner role, inside the church). */
async function nettoyer(nomEglise: string) {
  await avecBase(async (client) => {
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM "Eglise" WHERE nom = $1`, [
      nomEglise,
    ]);
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.eglise_id', $1, true)", [rows[0]!.id]);
    const motif = `${PREFIXE} %`;
    await client.query(
      `DELETE FROM "Enfant" WHERE "familleId" IN (SELECT id FROM "Famille" WHERE nom LIKE $1)`,
      [motif],
    );
    await client.query(`DELETE FROM "Famille" WHERE nom LIKE $1`, [motif]);
    await client.query("COMMIT");
  });
}

test.beforeEach(async ({}, testInfo) => {
  await reinitialiserLimites();
  await nettoyer(EGLISES[egliseDuProjet(testInfo)]);
});

test.afterEach(async ({}, testInfo) => {
  await nettoyer(EGLISES[egliseDuProjet(testInfo)]);
});

const photo = (page: Page, libelle: string) =>
  page.getByLabel(libelle, { exact: true }).setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: PNG,
  });

test("l'accueil inscrit une famille de 3 enfants et la retrouve par la recherche", async ({
  page,
}, testInfo) => {
  const eglise = egliseDuProjet(testInfo);
  const nom = `${PREFIXE} Agbodjan`;
  await seConnecter(page, email("accueil", eglise));
  await attendreAccueil(page, EGLISES[eglise]);

  await page.getByRole("link", { name: "Familles" }).click();
  await page.getByRole("link", { name: "Inscrire une famille" }).click();
  await expect(page.getByRole("heading", { name: "Inscrire une famille" })).toBeVisible();

  await page.getByLabel("Nom de la famille", { exact: true }).fill(nom);
  await page.getByLabel("Prénom du tuteur 1", { exact: true }).fill("Mireille");
  await page.getByLabel("Nom du tuteur 1", { exact: true }).fill("Agbodjan");
  await page.getByLabel("Lien du tuteur 1 avec les enfants", { exact: true }).fill("Mère");
  // A Beninese number in the former 8-digit plan: the form proposes the new number.
  await page.getByLabel("Téléphone du tuteur 1", { exact: true }).fill("97 45 12 33");
  await page.getByLabel("Téléphone du tuteur 1", { exact: true }).blur();
  await expect(
    page.getByRole("alert").filter({ hasText: "Voulez-vous dire 01 97 45 12 33 ?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Oui, utiliser le 01 97 45 12 33" }).click();
  await expect(page.getByLabel("Téléphone du tuteur 1", { exact: true })).toHaveValue(
    "01 97 45 12 33",
  );
  await photo(page, "Photo du tuteur 1");
  await expect(page.getByRole("img", { name: "Photo du tuteur 1" })).toBeVisible();

  const enfants = [
    ["Ayo", "2019-03-14"],
    ["Sèna", "2021-08-02"],
    ["Koffi", "2023-01-20"],
  ] as const;
  for (const [i, [prenom, naissance]] of enfants.entries()) {
    if (i > 0) await page.getByRole("button", { name: "Ajouter un enfant" }).click();
    await page.getByLabel(`Prénom de l'enfant ${i + 1}`, { exact: true }).fill(prenom);
    await page.getByLabel(`Nom de l'enfant ${i + 1}`, { exact: true }).fill("Agbodjan");
    await page
      .getByLabel(`Date de naissance de l'enfant ${i + 1}`, { exact: true })
      .fill(naissance);
  }
  // Without the photo consent, no child photo can be taken.
  await expect(page.getByLabel("Photo de l'enfant 1", { exact: true })).toHaveCount(0);

  // The data consent is compulsory: the server refuses, with a message saying what to do.
  await page.getByRole("button", { name: "Enregistrer l'inscription" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "consentement" })).toBeVisible();

  await page.getByLabel(/J'accepte que les données de mes enfants/).check();
  await page.getByRole("button", { name: "Enregistrer l'inscription" }).click();

  await expect(page).toHaveURL(/\/familles\/(?!nouvelle)[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: `Famille ${nom}`, level: 1 })).toBeVisible();
  const sectionEnfants = page.locator("section", {
    has: page.getByRole("heading", { name: "Enfants", level: 2 }),
  });
  await expect(sectionEnfants.getByText(/^HK-\d{4,5}$/)).toHaveCount(3);
  const photoAdulte = page.getByRole("img", { name: "Photo de Mireille Agbodjan" });
  await expect
    .poll(() => photoAdulte.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);

  // Stored in E.164, shown formatted.
  await expect(page.getByRole("link", { name: "+229 01 97 45 12 33" })).toHaveAttribute(
    "href",
    "tel:+2290197451233",
  );

  for (const terme of ["Sèna", "97 45 12 33"]) {
    await page.goto(`/familles?q=${encodeURIComponent(terme)}`);
    await expect(
      page.getByRole("region", { name: "Résultats" }).getByRole("link", { name: new RegExp(nom) }),
      terme,
    ).toBeVisible();
  }
});

test("le moniteur n'a pas accès aux familles", async ({ page }, testInfo) => {
  const eglise = egliseDuProjet(testInfo);
  await seConnecter(page, email("moniteur", eglise));
  await attendreAccueil(page, EGLISES[eglise]);
  await expect(page.getByRole("link", { name: "Familles" })).toHaveCount(0);
  expect((await page.goto("/familles"))?.status()).toBe(404);
  expect((await page.goto("/familles/nouvelle"))?.status()).toBe(404);
});

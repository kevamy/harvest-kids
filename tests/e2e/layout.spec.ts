import { expect, test } from "@playwright/test";
import {
  EGLISES,
  EMAIL_DEUX_EGLISES,
  attendreAccueil,
  egliseDuProjet,
  email,
  reinitialiserLimites,
  seConnecter,
} from "./support/base";

test.beforeEach(async () => {
  await reinitialiserLimites();
});

/** Saved under test-results/, one per viewport (review of the tablet layout). */
async function capture(page: import("@playwright/test").Page, nom: string) {
  // Next.js dev tools badge (dev server only), not part of the application.
  await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((e) => e.remove()));
  await page.waitForFunction(() =>
    Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0),
  );
  await page.screenshot({ path: test.info().outputPath(`${nom}.png`), fullPage: true });
}

test("l'en-tête porte le logo et le nom de l'église active, le pied de page Harvest Kids", async ({
  page,
}) => {
  await seConnecter(page, email("accueil", "cotonou"));
  await attendreAccueil(page, EGLISES.cotonou);

  const entete = page.getByRole("banner");
  const logo = entete.getByRole("img", { name: `Logo de ${EGLISES.cotonou}` });
  await expect(logo).toBeVisible();
  // Served by the authenticated route, and actually decoded by the browser.
  await expect(logo).toHaveAttribute("src", /^\/api\/fichiers\/eglises\//);
  expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await expect(page.getByRole("contentinfo")).toHaveText("Harvest Kids");
  // Single-church account: no church switcher.
  await expect(page.getByRole("link", { name: "Changer d'église" })).toHaveCount(0);
  await capture(page, "eglise-a-avec-logo");
});

test("sans logo, l'en-tête affiche le nom de l'église en Fredoka", async ({ page }) => {
  await seConnecter(page, email("accueil", "porto-novo"));
  await attendreAccueil(page, EGLISES["porto-novo"]);

  const entete = page.getByRole("banner");
  await expect(entete.getByRole("img")).toHaveCount(0);
  const nom = page.getByTestId("eglise-active");
  expect(await nom.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/fredoka/i);
  await capture(page, "eglise-b-sans-logo");
});

test("un compte de deux églises dispose du sélecteur d'église", async ({ page }, testInfo) => {
  const eglise = egliseDuProjet(testInfo);
  await seConnecter(page, EMAIL_DEUX_EGLISES);
  await expect(page).toHaveURL(/\/choisir-eglise$/, { timeout: 20_000 });
  await page.getByRole("button", { name: EGLISES[eglise] }).click();
  await attendreAccueil(page, EGLISES[eglise]);

  await expect(page.getByRole("link", { name: "Changer d'église" })).toBeVisible();
  await capture(page, "compte-deux-eglises");
});

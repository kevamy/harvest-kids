import { expect, test } from "@playwright/test";
import {
  EGLISES,
  EMAIL_SUPER_ADMIN,
  MOT_DE_PASSE,
  attendreAccueil,
  cleLogo,
  email,
  reinitialiserLimites,
  seConnecter,
  supprimerCompteDeTest,
  supprimerEgliseDeTest,
} from "./support/base";

test.beforeEach(async () => {
  await reinitialiserLimites();
});

test("la console de plateforme n'existe pas pour un administrateur d'église", async ({ page }) => {
  await seConnecter(page, email("admin", "cotonou"));
  await attendreAccueil(page, EGLISES.cotonou);
  const reponse = await page.goto("/plateforme");
  expect(reponse?.status()).toBe(404);
});

test("le super-administrateur crée une église et son premier administrateur", async ({
  page,
}, testInfo) => {
  const slug = `e2e-${testInfo.project.name}`;
  const adresseAdmin = `admin.${slug}@harvest-kids.test`;
  await supprimerEgliseDeTest(slug);
  await supprimerCompteDeTest(adresseAdmin);
  try {
    await seConnecter(page, EMAIL_SUPER_ADMIN, MOT_DE_PASSE);
    await expect(page).toHaveURL(/\/plateforme$/, { timeout: 20_000 });

    await page.getByRole("link", { name: "Créer une église" }).click();
    await page.getByLabel("Nom de l'église").fill(`Église de test ${testInfo.project.name}`);
    await page.getByLabel("Adresse courte (écran d'appel)").fill(slug);
    await page.getByLabel("Nom", { exact: true }).fill("Administrateur de test");
    await page.getByLabel("E-mail").fill(adresseAdmin);
    await page.getByLabel("Mot de passe provisoire").fill("Provisoire-2026");
    await page.getByRole("button", { name: "Créer l'église" }).click();

    await expect(page).toHaveURL(/\/plateforme$/);
    await expect(
      page.getByRole("article", { name: `Église de test ${testInfo.project.name}` }),
    ).toBeVisible();
  } finally {
    await supprimerEgliseDeTest(slug);
    await supprimerCompteDeTest(adresseAdmin);
  }
});

test("le logo de l'église A demandé depuis l'église B répond 404", async ({ page }) => {
  const cle = await cleLogo("demo-cotonou");
  expect(cle).not.toBeNull();

  await seConnecter(page, email("accueil", "cotonou"));
  await attendreAccueil(page, EGLISES.cotonou);
  expect((await page.request.get(`/api/fichiers/${cle}`)).status()).toBe(200);

  await page.context().clearCookies();
  await seConnecter(page, email("accueil", "porto-novo"));
  await attendreAccueil(page, EGLISES["porto-novo"]);
  const depuisB = await page.request.get(`/api/fichiers/${cle}`);
  const inexistant = await page.request.get(
    `/api/fichiers/${cle!.replace(/[^/]+$/, "absent.png")}`,
  );
  expect(depuisB.status()).toBe(404);
  expect(inexistant.status()).toBe(404);
  expect(await depuisB.body()).toEqual(await inexistant.body());
});

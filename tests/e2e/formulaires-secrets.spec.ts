import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { egliseDuProjet, email, reinitialiserLimites } from "./support/base";

/**
 * A form holding a secret, submitted before React has hydrated the page (slow
 * network, JavaScript not loaded yet), must never put the secret in the URL or in
 * the server logs, and must never break the page.
 */
test.use({ javaScriptEnabled: false });

test.beforeEach(async () => {
  await reinitialiserLimites();
});

// Fictitious secret, unique per project, searched for in the URL and in the logs.
const secret = (projet: string) => `Secret-${projet}-${Date.now()}`;

test("sans JavaScript, le bouton de connexion est réellement désactivé et reste lisible", async ({
  page,
}) => {
  await page.goto("/connexion");
  const bouton = page.getByRole("button", { name: "Se connecter" });
  await expect(bouton).toBeVisible();
  await expect(bouton).toBeDisabled();
  await expect(bouton).toHaveAttribute("disabled", "");
  await expect(page.locator("form").first()).toHaveAttribute("method", "post");
});

test("une soumission avant l'hydratation part en POST, réaffiche la connexion, sans fuite du mot de passe", async ({
  page,
}, testInfo) => {
  const motDePasse = secret(testInfo.project.name);
  await page.goto("/connexion");
  await page.getByLabel("E-mail ou téléphone").fill(email("accueil", egliseDuProjet(testInfo)));
  await page.getByLabel("Mot de passe").fill(motDePasse);

  // What the browser does on its own when the form is submitted before hydration
  // (the button is disabled, so it is forced here).
  const reponse = page.waitForResponse((r) => new URL(r.url()).pathname === "/connexion");
  await page
    .locator("form")
    .first()
    .evaluate((f: HTMLFormElement) => f.submit());
  const soumission = await reponse;

  expect(soumission.request().method()).toBe("POST");
  expect(soumission.status()).toBeLessThan(500);
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  expect(page.url()).not.toContain(motDePasse);
  expect(new URL(page.url()).search).toBe("");

  const journal = process.env.HK_JOURNAL_SERVEUR;
  test.skip(
    !journal || !existsSync(journal),
    "Serveur démarré hors de Playwright : ses journaux ne sont pas capturés.",
  );
  expect(readFileSync(journal!, "utf8")).not.toContain(motDePasse);
});

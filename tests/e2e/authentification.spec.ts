import { expect, test } from "@playwright/test";
import {
  EGLISES,
  EMAIL_DEUX_EGLISES,
  attendreAccueil,
  derniereActivite,
  egliseDuProjet,
  email,
  reinitialiserLimites,
  seConnecter,
  vieillirDerniereActivite,
} from "./support/base";

test.beforeEach(async () => {
  await reinitialiserLimites();
});

test("une page protégée renvoie vers la connexion", async ({ page }) => {
  await page.goto("/accueil");
  await expect(page).toHaveURL(/\/connexion/);
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
});

test.describe("connexion par rôle", () => {
  for (const [libelle, role] of [
    ["admin", "Administrateur"],
    ["responsable", "Responsable"],
    ["accueil", "Accueil"],
    ["moniteur", "Moniteur"],
    ["infirmerie", "Infirmerie"],
  ] as const) {
    test(`${libelle} entre dans son église avec son rôle`, async ({ page }, testInfo) => {
      const eglise = egliseDuProjet(testInfo);
      await seConnecter(page, email(libelle, eglise));
      await attendreAccueil(page, EGLISES[eglise]);
      await expect(page.getByRole("list", { name: "Rôles" })).toHaveText(role);
    });
  }
});

test("connexion par numéro de téléphone", async ({ page }) => {
  // Fictitious number of the Cotonou reception account (seed).
  await seConnecter(page, "01 97 01 00 20");
  await attendreAccueil(page, EGLISES.cotonou);
});

test("un mauvais mot de passe affiche un message qui dit quoi faire", async ({
  page,
}, testInfo) => {
  await seConnecter(page, email("accueil", egliseDuProjet(testInfo)), "pas-le-bon-mot-de-passe");
  await expect(
    page.getByRole("alert").filter({ hasText: "Identifiant ou mot de passe incorrect" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/connexion/);
});

test("un membre de deux églises choisit puis change d'église", async ({ page }) => {
  await seConnecter(page, EMAIL_DEUX_EGLISES);
  // Sign-in hashes the password (scrypt): allow for parallel workers.
  await expect(page).toHaveURL(/\/choisir-eglise$/, { timeout: 20_000 });
  await page.getByRole("button", { name: EGLISES["porto-novo"] }).click();
  await attendreAccueil(page, EGLISES["porto-novo"]);

  await page.getByRole("link", { name: "Changer d'église" }).click();
  await page.getByRole("button", { name: EGLISES.cotonou }).click();
  await attendreAccueil(page, EGLISES.cotonou);
});

test("un rafraîchissement automatique ne compte pas comme activité", async ({ page }, testInfo) => {
  const eglise = egliseDuProjet(testInfo);
  const adresse = email("responsable", eglise);
  await seConnecter(page, adresse);
  await attendreAccueil(page, EGLISES[eglise]);

  await vieillirDerniereActivite(adresse, 5);
  const avant = await derniereActivite(adresse);
  const etat = await page.request.get("/api/session/etat", {
    headers: { "x-hk-rafraichissement": "1" },
  });
  expect(await etat.json()).toEqual({ connecte: true, verrouillee: false });
  expect(await derniereActivite(adresse)).toEqual(avant);

  // A real interaction is recorded.
  expect((await page.request.post("/api/session/activite")).status()).toBe(204);
  expect((await derniereActivite(adresse)).getTime()).toBeGreaterThan(avant.getTime());
});

test("les pages portent une politique de sécurité du contenu avec nonce", async ({ request }) => {
  const reponse = await request.get("/connexion");
  const csp = reponse.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(reponse.headers()["x-content-type-options"]).toBe("nosniff");
});

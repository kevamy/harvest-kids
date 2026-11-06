import type { Browser, Page } from "@playwright/test";
import { alerte, attendreAccueil, reinitialiserLimites, seConnecter } from "./support/base";
import { expect, test } from "./support/eglise-isolee";

/**
 * Accounts and roles (cahier §7.10, ADR 0014), in a church created for the test: creation
 * with a one-time activation link, activation in a fresh browser, deactivation, password
 * reset with its confirmation dialog. Accounts made here follow the clean-up pattern of the
 * isolated church (…​.<slug>@e2e.harvest-kids.test).
 */

test.beforeEach(reinitialiserLimites);

const NOUVEAU_MOT_DE_PASSE = "Nouveau-secret-2026";

async function lienAffiche(page: Page) {
  const lien = await page.getByLabel("Lien à transmettre").inputValue();
  expect(lien).toMatch(/\/activation#HKC1\.[0-9A-Za-z]{43}$/);
  return lien;
}

/** Fills and sends the activation form (the token is checked when it is sent). */
async function soumettre(page: Page, motDePasse: string) {
  await page.getByLabel("Nouveau mot de passe").fill(motDePasse);
  await page.getByLabel("Confirmez le mot de passe").fill(motDePasse);
  await page.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
}

const LIEN_REFUSE = "Ce lien a expiré ou a déjà servi";

/** Opens the link in a fresh browser (the person's phone) and chooses the password. */
async function choisirMotDePasse(browser: Browser, lien: string) {
  const contexte = await browser.newContext();
  const page = await contexte.newPage();
  const reponse = await page.goto(lien);
  expect(reponse?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(reponse?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  // The token leaves the address bar and the history as soon as it is read.
  await expect.poll(() => page.url()).not.toContain("#");
  await soumettre(page, NOUVEAU_MOT_DE_PASSE);
  await expect(page.getByRole("status")).toHaveText(
    "Mot de passe enregistré. Vous pouvez maintenant vous connecter.",
  );
  return { contexte, page };
}

test("l'administrateur crée un moniteur, qui active son compte puis perd l'accès une fois désactivé", async ({
  page,
  browser,
  eglise,
}) => {
  // Two browsers, two sign-ins and an activation: longer than the default limit.
  test.slow();
  const adresse = `koffi.${eglise.slug}@e2e.harvest-kids.test`;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await seConnecter(page, eglise.email("ADMIN"));
  await attendreAccueil(page, eglise.nom);
  await page.goto("/parametres");
  await page.getByRole("link", { name: /Comptes et rôles/ }).click();
  await expect(page.getByRole("heading", { name: "Comptes et rôles" })).toBeVisible();

  // The administrator's own account cannot be deactivated from here.
  const comptes = page.getByRole("list", { name: "Comptes de l'église" });
  const soi = comptes.getByRole("listitem").filter({ hasText: "(vous)" });
  await expect(soi.getByRole("button", { name: "Désactiver le compte" })).toHaveCount(0);

  await page.getByLabel("Nom et prénom").fill("Koffi Nouveau");
  await page.getByLabel("E-mail ou téléphone").fill(adresse);
  await page.locator("#nouveau-MONITEUR").check();
  await page.getByRole("button", { name: "Ajouter le compte" }).click();
  await expect(page.getByText("Compte de Koffi Nouveau ajouté.")).toBeVisible();
  const lien = await lienAffiche(page);
  await page.getByRole("button", { name: "Copier le lien" }).click();
  await expect(page.getByText("Lien copié.")).toBeVisible();
  const koffi = comptes.getByRole("listitem", { name: "Koffi Nouveau" });
  await expect(koffi).toContainText("En attente d'activation");

  const personne = await choisirMotDePasse(browser, lien);
  try {
    // Used once only. Pasted again in the same tab, only the fragment changes: the form
    // starts over (hashchange) and sending it is refused.
    await personne.page.goto(lien);
    await expect(personne.page.getByText("Mot de passe enregistré.")).toHaveCount(0);
    await soumettre(personne.page, "Encore-un-autre-2026");
    await expect(alerte(personne.page, LIEN_REFUSE)).toBeVisible();
    // Opened in a new tab (from the message again): refused too.
    const onglet = await personne.contexte.newPage();
    await onglet.goto(lien);
    await soumettre(onglet, "Encore-un-autre-2026");
    await expect(alerte(onglet, LIEN_REFUSE)).toBeVisible();
    await onglet.close();

    await seConnecter(personne.page, adresse, NOUVEAU_MOT_DE_PASSE);
    // A new member first chooses their PIN: they reached the church.
    await expect(personne.page).toHaveURL(/\/code-pin$/, { timeout: 15_000 });

    await page.reload();
    await expect(koffi).toContainText("Actif");
    await koffi.getByRole("button", { name: "Désactiver le compte" }).click();
    const modale = page.getByRole("dialog", { name: "Désactiver le compte de Koffi Nouveau ?" });
    await modale.getByRole("button", { name: "Désactiver le compte" }).click();
    await expect(page.getByText("Compte de Koffi Nouveau désactivé.")).toBeVisible();
    await expect(koffi).toContainText("Désactivé");

    await personne.page.goto("/accueil");
    await expect(personne.page).toHaveURL(/\/choisir-eglise$/);
    await expect(
      personne.page.getByText("Votre compte n'est rattaché à aucune église active."),
    ).toBeVisible();
  } finally {
    await personne.contexte.close();
  }
});

test("la réinitialisation, confirmée dans une modale, efface le mot de passe tout de suite", async ({
  page,
  browser,
  eglise,
}) => {
  // Three browsers and three sign-ins: longer than the default limit.
  test.slow();
  await seConnecter(page, eglise.email("ADMIN"));
  await attendreAccueil(page, eglise.nom);
  await page.goto("/parametres/comptes");
  const accueil = page
    .getByRole("list", { name: "Comptes de l'église" })
    .getByRole("listitem")
    .filter({ hasText: eglise.email("ACCUEIL") });
  await accueil.getByRole("button", { name: "Réinitialiser le mot de passe" }).click();
  const modale = page.getByRole("dialog");
  await expect(modale).toContainText("tout de suite");
  // Cancelling changes nothing.
  await modale.getByRole("button", { name: "Annuler" }).click();
  await expect(modale).toBeHidden();
  await accueil.getByRole("button", { name: "Réinitialiser le mot de passe" }).click();
  await modale.getByRole("button", { name: "Réinitialiser le mot de passe" }).click();
  await expect(page.getByText(/réinitialisé\.$/)).toBeVisible();
  await expect(page.getByText(/valable 24 heures/)).toBeVisible();
  const lien = await lienAffiche(page);
  await expect(accueil).toContainText("Mot de passe à redéfinir");

  // The old password no longer works.
  const contexte = await browser.newContext();
  try {
    const autre = await contexte.newPage();
    await seConnecter(autre, eglise.email("ACCUEIL"));
    await expect(alerte(autre, "Identifiant ou mot de passe incorrect")).toBeVisible();
  } finally {
    await contexte.close();
  }
  const personne = await choisirMotDePasse(browser, lien);
  try {
    await seConnecter(personne.page, eglise.email("ACCUEIL"), NOUVEAU_MOT_DE_PASSE);
    await attendreAccueil(personne.page, eglise.nom);
  } finally {
    await personne.contexte.close();
  }
});

test("l'accueil n'a pas accès aux comptes", async ({ page, eglise }) => {
  await seConnecter(page, eglise.email("ACCUEIL"));
  await attendreAccueil(page, eglise.nom);
  expect((await page.goto("/parametres/comptes"))?.status()).toBe(404);
});

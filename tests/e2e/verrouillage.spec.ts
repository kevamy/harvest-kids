import {
  PIN,
  attendreAccueil,
  reinitialiserLimites,
  seConnecter,
  vieillirDerniereActivite,
} from "./support/base";
import { expect, test } from "./support/eglise-isolee";

// A wrong PIN is counted on the member: in a church created for the test.
test.beforeEach(reinitialiserLimites);

test("la tablette se verrouille après 15 minutes et se déverrouille avec le PIN", async ({
  page,
  eglise,
}) => {
  const adresse = eglise.email("INFIRMERIE");
  await seConnecter(page, adresse);
  await attendreAccueil(page, eglise.nom);

  await vieillirDerniereActivite(adresse, 16);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Tablette verrouillée" })).toBeVisible();
  await expect(page.getByTestId("eglise-active")).toHaveCount(0);

  await page.getByLabel("Code PIN").fill("111222");
  await page.getByRole("button", { name: "Déverrouiller" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Il vous reste 4 essais" })).toBeVisible();

  await page.getByLabel("Code PIN").fill(PIN);
  await page.getByRole("button", { name: "Déverrouiller" }).click();
  await attendreAccueil(page, eglise.nom);
});

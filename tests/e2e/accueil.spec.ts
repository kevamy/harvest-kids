import { expect, test } from "@playwright/test";

test("sans session, l'entrée de l'application mène à la connexion, en français", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page).toHaveTitle("Connexion — Harvest Kids");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("img", { name: "Harvest Kids" })).toBeVisible();
});

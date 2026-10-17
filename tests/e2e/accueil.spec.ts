import { expect, test } from "@playwright/test";

test("la page d'accueil s'affiche en français", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Harvest Kids");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByRole("heading", { level: 1, name: "Harvest Kids" })).toBeVisible();
});

import { expect, test } from "@playwright/test";

test.describe("page de démonstration du design system", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/design");
  });

  test("s'affiche sans défilement horizontal", async ({ page }, testInfo) => {
    await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible();
    const deborde = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(deborde).toBe(false);
    // Visual reference attached to the report (pixel baselines differ between OSes).
    await testInfo.attach("design", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });

  test("utilise les polices et couleurs du design system", async ({ page }) => {
    const styles = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const titre = getComputedStyle(document.querySelector("h1")!);
      return { fond: body.backgroundColor, police: body.fontFamily, titre: titre.fontFamily };
    });
    expect(styles.fond).toBe("rgb(251, 240, 242)"); // creme
    expect(styles.police.toLowerCase()).toContain("nunito");
    expect(styles.titre.toLowerCase()).toContain("fredoka");
  });

  test("les boutons offrent une cible tactile d'au moins 56 px", async ({ page }) => {
    const hauteurs = await page
      .locator('main [data-slot="button"]')
      .evaluateAll((boutons) => boutons.map((b) => b.getBoundingClientRect().height));
    expect(hauteurs.length).toBeGreaterThan(0);
    for (const hauteur of hauteurs) expect(hauteur).toBeGreaterThanOrEqual(56);
  });

  test("chaque statut est écrit en toutes lettres", async ({ page }) => {
    const libelles = ["Attendu", "Présent", "En salle", "Parent appelé", "Infirmerie", "Récupéré"];
    for (const libelle of libelles) {
      await expect(page.locator("span[data-statut]", { hasText: libelle }).first()).toBeVisible();
    }
  });

  test("l'enfant à l'infirmerie est en tête de liste (RG-07)", async ({ page }) => {
    const premiere = page.locator("article[data-statut]").first();
    await expect(premiere).toHaveAttribute("data-statut", "INFIRMERIE");
  });

  test("l'écran d'appel n'affiche que des matricules (RG-10)", async ({ page }) => {
    const ecran = page.locator('[data-slot="call-board"]');
    await expect(ecran.locator("li")).toHaveCount(3);
    await expect(ecran).not.toContainText("Ayo");
    await expect(ecran).not.toContainText("Dossou");
    await expect(ecran.locator("img")).toHaveCount(0);
  });

  test("le scanner capte une saisie terminée par Entrée (douchette)", async ({ page }) => {
    const champ = page.getByLabel("Scannez la carte famille ou saisissez le code");
    await champ.fill("HKF1.demo");
    await champ.press("Enter");
    await expect(page.getByText("Code lu : HKF1.demo")).toBeVisible();
    await expect(champ).toHaveValue("");
    await expect(champ).toBeFocused();
  });
});

test("le manifeste PWA et le service worker sont servis", async ({ request }) => {
  const manifeste = await request.get("/manifest.webmanifest");
  expect(manifeste.ok()).toBe(true);
  const contenu = await manifeste.json();
  expect(contenu.name).toBe("Harvest Kids");
  expect(contenu.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);

  const sw = await request.get("/serwist/sw.js");
  expect(sw.ok()).toBe(true);
  expect(await sw.text()).toContain("hors-connexion");
});

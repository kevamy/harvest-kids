import { expect, test } from "@playwright/test";
import {
  EGLISES,
  attendreAccueil,
  avecBase,
  egliseDuProjet,
  email,
  reinitialiserLimites,
  seConnecter,
} from "./support/base";

const PREFIXE_CLASSE = "E2E ";

/**
 * Puts the demonstration church back as the seed left it: default settings, no test
 * class. Owner connection, inside the church (FORCE RLS applies to the owner too).
 */
async function remettreEnEtat(nomEglise: string) {
  await avecBase(async (client) => {
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM "Eglise" WHERE nom = $1`, [
      nomEglise,
    ]);
    const egliseId = rows[0]!.id;
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.eglise_id', $1, true)", [egliseId]);
    await client.query(
      `DELETE FROM "Parametre" WHERE cle IN ('cartes.mode', 'impression', 'cartes.textes')`,
    );
    await client.query(`DELETE FROM "Classe" WHERE nom LIKE $1`, [`${PREFIXE_CLASSE}%`]);
    await client.query("COMMIT");
  });
}

test.beforeEach(async ({}, testInfo) => {
  await reinitialiserLimites();
  await remettreEnEtat(EGLISES[egliseDuProjet(testInfo)]);
});

test.afterEach(async ({}, testInfo) => {
  await remettreEnEtat(EGLISES[egliseDuProjet(testInfo)]);
});

test("l'administrateur règle l'impression et le mode de carte", async ({ page }, testInfo) => {
  const eglise = egliseDuProjet(testInfo);
  await seConnecter(page, email("admin", eglise));
  await attendreAccueil(page, EGLISES[eglise]);

  await page.getByRole("link", { name: "Paramètres" }).click();
  await expect(page.getByRole("heading", { name: "Paramètres", level: 1 })).toBeVisible();
  for (const section of [
    "Église",
    "Cartes",
    "Classes et tranches d'âge",
    "Impression des cartes",
    "Familles à compléter",
  ]) {
    await expect(page.getByRole("link", { name: new RegExp(`^${section}`) })).toBeVisible();
  }

  // Print settings: default is 90 × 54, front only.
  await page.getByRole("link", { name: /^Impression des cartes/ }).click();
  await expect(page).toHaveURL(/\/parametres\/impression$/);
  await expect(page.getByRole("radio", { name: /Carte 90 × 54 mm/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Recto seul/ })).toBeChecked();
  await page.getByRole("radio", { name: /Carte PVC CR80/ }).check();
  await page.getByRole("radio", { name: /Recto-verso/ }).check();
  await page.getByRole("button", { name: "Enregistrer les réglages d'impression" }).click();
  await expect(page.getByRole("status")).toHaveText("Réglages d'impression enregistrés.");
  await page.reload();
  await expect(page.getByRole("radio", { name: /Carte PVC CR80/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Recto-verso/ })).toBeChecked();

  // Card mode: the administrator is warned before the change.
  await page.goto("/parametres/cartes");
  await expect(page.getByRole("radio", { name: /Une carte par famille/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "Changer le mode de carte" })).toBeDisabled();
  await page.getByRole("radio", { name: /Une carte par enfant/ }).check();
  await expect(page.getByRole("note")).toContainText(
    "Les cartes déjà remises restent valides jusqu'à leur révocation.",
  );
  await page.getByRole("button", { name: "Changer le mode de carte" }).click();
  await expect(page.getByRole("status")).toHaveText("Mode de carte changé.");
  await page.reload();
  await expect(page.getByRole("radio", { name: /Une carte par enfant/ })).toBeChecked();
});

test("l'administrateur règle les textes de la carte, repris par les aperçus", async ({
  page,
}, testInfo) => {
  const eglise = egliseDuProjet(testInfo);
  await seConnecter(page, email("admin", eglise));
  await attendreAccueil(page, EGLISES[eglise]);
  await page.goto("/parametres/impression");

  // Defaults, front only: the footer shows the short instruction in all five formats.
  const pieds = page.locator("[data-testid^='pied-']");
  await expect(pieds).toHaveCount(5);
  await expect(page.getByLabel("Consigne courte du recto")).toHaveAttribute("maxlength", "60");

  await page.getByLabel(/Afficher le téléphone de l'accueil enfants/).uncheck();
  await page.getByLabel("Consigne courte du recto").fill("Carte à présenter à l'accueil.");
  await page.getByLabel("Titre du verso").fill("Accueil des enfants");
  await page.getByRole("button", { name: "Retirer la consigne 3" }).click();
  await page
    .getByRole("textbox", { name: "Consigne 2", exact: true })
    .fill("Signalez une carte perdue.");
  await page.getByRole("button", { name: "Enregistrer les textes de la carte" }).click();
  await expect(page.getByRole("status")).toHaveText("Textes de la carte enregistrés.");

  await page.reload();
  for (const pied of await pieds.all()) {
    await expect(pied).toHaveText("Carte à présenter à l'accueil.");
  }

  // Both sides: the back previews show the title and the instructions.
  await page.getByRole("radio", { name: /Recto-verso/ }).check();
  await page.getByRole("button", { name: "Enregistrer les réglages d'impression" }).click();
  await expect(page.getByRole("status").first()).toHaveText("Réglages d'impression enregistrés.");
  await page.reload();
  const versos = page.locator("[data-testid^='verso-']");
  await expect(versos).toHaveCount(5);
  for (const verso of await versos.all()) {
    await expect(verso).toContainText("Accueil des enfants");
    await expect(verso).toContainText("Signalez une carte perdue.");
    await expect(verso).not.toContainText("Accueil enfants :");
  }
  await page.locator("[data-testid='verso-CR80']").screenshot({
    path: testInfo.outputPath("verso-cr80.png"),
  });
});

test("le responsable gère les classes, sans accès aux autres paramètres", async ({
  page,
}, testInfo) => {
  const eglise = egliseDuProjet(testInfo);
  await seConnecter(page, email("responsable", eglise));
  await attendreAccueil(page, EGLISES[eglise]);

  await page.getByRole("link", { name: "Paramètres" }).click();
  await expect(page.getByRole("link", { name: /^Classes et tranches d'âge/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Cartes/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Impression des cartes/ })).toHaveCount(0);
  for (const chemin of ["/parametres/cartes", "/parametres/impression", "/parametres/eglise"]) {
    const reponse = await page.goto(chemin);
    expect(reponse?.status(), chemin).toBe(404);
  }

  // The seed's classes follow one another: nothing to report.
  await page.goto("/parametres/classes");
  await expect(
    page.getByText("Les tranches des classes actives se suivent sans chevauchement ni trou."),
  ).toBeVisible();

  // An overlapping class is reported, never refused.
  const ajout = page
    .getByRole("region", { name: "Ajouter une classe" })
    .or(
      page.locator("section", { has: page.getByRole("heading", { name: "Ajouter une classe" }) }),
    );
  await ajout.getByLabel("Nom de la classe").fill(`${PREFIXE_CLASSE}Chevauchement`);
  await ajout.getByLabel("Âge minimum (mois)").fill("30");
  await ajout.getByLabel("Âge maximum (mois)").fill("40");
  await ajout.getByRole("button", { name: "Ajouter la classe" }).click();
  await expect(ajout.getByRole("status")).toHaveText("Classe ajoutée.");
  await expect(page.getByTestId("signalements-tranches")).toContainText(
    `${PREFIXE_CLASSE}Chevauchement`,
  );
  await expect(page.getByTestId("signalements-tranches")).toContainText("se chevauchent");

  // Deactivating it removes the warning.
  const carte = page.getByRole("region", { name: `Classe ${PREFIXE_CLASSE}Chevauchement` });
  await carte.getByLabel("Classe active").uncheck();
  await carte.getByRole("button", { name: "Enregistrer la classe" }).click();
  await expect(carte.getByRole("status")).toHaveText("Classe enregistrée.");
  await expect(
    page.getByText("Les tranches des classes actives se suivent sans chevauchement ni trou."),
  ).toBeVisible();
});

test("l'accueil n'a pas accès aux paramètres", async ({ page }, testInfo) => {
  const eglise = egliseDuProjet(testInfo);
  await seConnecter(page, email("accueil", eglise));
  await attendreAccueil(page, EGLISES[eglise]);

  await expect(page.getByRole("link", { name: "Paramètres" })).toHaveCount(0);
  const reponse = await page.goto("/parametres");
  expect(reponse?.status()).toBe(404);
});

// A valid 4 × 4 PNG made by sharp (red pixels), small enough to inline.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWM4YKn9HxkzkC4AAIVoIjHsbvoAAAAAAElFTkSuQmCC",
  "base64",
);

test("l'administrateur téléverse un logo, converti par sharp sur le build de production", async ({
  page,
}) => {
  // Porto-Novo has no logo in the seed: it is restored to exactly that state afterwards.
  const nomEglise = EGLISES["porto-novo"];
  const sansLogo = () =>
    avecBase((c) =>
      c.query(`UPDATE "Eglise" SET "logoKey" = NULL, "logoClairKey" = NULL WHERE nom = $1`, [
        nomEglise,
      ]),
    );
  await sansLogo();
  try {
    await seConnecter(page, email("admin", "porto-novo"));
    await attendreAccueil(page, nomEglise);
    await page.goto("/parametres/eglise");

    const carte = page.locator("section", {
      has: page.getByRole("heading", { name: "Logo", exact: true }),
    });
    const apercu = carte.getByRole("img", { name: `Logo de ${nomEglise}` });
    const televerser = async (precedent?: string) => {
      await carte.getByLabel("Fichier PNG ou SVG (2 Mo au plus)").setInputFiles({
        name: "logo.png",
        mimeType: "image/png",
        buffer: PNG,
      });
      await carte.getByRole("button", { name: "Enregistrer le logo" }).click();
      await expect(carte.getByRole("status")).toHaveText("Logo enregistré.");
      // The message of a previous upload may still be shown: wait for the new image.
      if (precedent) await expect(apercu).not.toHaveAttribute("src", precedent);
      // The stored PNG is served by the authenticated route and decoded by the browser.
      await expect(apercu).toHaveAttribute(
        "src",
        /^\/api\/fichiers\/eglises\/.+\/logo\/principal-.+\.png$/,
      );
      await expect
        .poll(() => apercu.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
        .toBeGreaterThan(0);
      return (await apercu.getAttribute("src"))!;
    };

    const premier = await televerser();
    await expect(
      page.getByRole("banner").getByRole("img", { name: `Logo de ${nomEglise}` }),
    ).toHaveAttribute("src", premier);

    // Same file again: a new key, so no browser cache can serve the old logo. The old file
    // stays served (tablets still showing the old page) until the daily task deletes it, 24 h
    // later at the earliest.
    const second = await televerser(premier);
    expect(second).not.toBe(premier);
    await expect(
      page.getByRole("banner").getByRole("img", { name: `Logo de ${nomEglise}` }),
    ).toHaveAttribute("src", second);
    expect((await page.request.get(premier)).status()).toBe(200);
    expect((await page.request.get(second)).status()).toBe(200);

    // Saving a logo must not invalidate the prerendered service worker.
    const sw = await page.request.get("/serwist/sw.js");
    expect(sw.status()).toBe(200);
    expect(await sw.text()).toContain("hors-connexion");
  } finally {
    await sansLogo();
  }
});

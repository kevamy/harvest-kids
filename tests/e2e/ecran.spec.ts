import type { Browser, Page } from "@playwright/test";
import { attendreAccueil, reinitialiserLimites, seConnecter } from "./support/base";
import { expect, test, type EgliseIsolee } from "./support/eglise-isolee";

// Lot 3, step 5: call screen (cahier §7.8, ADR 0018; decisions of 2026-11-24). Each test
// works in a church created for it.
test.beforeEach(reinitialiserLimites);

/** The ADMIN adds a screen and gets its pairing link, shown once. */
async function lienDAppairage(page: Page, eglise: EgliseIsolee, nom: string): Promise<string> {
  await seConnecter(page, eglise.email("ADMIN"));
  await attendreAccueil(page, eglise.nom);
  await page.goto("/parametres");
  await page.getByRole("link", { name: /Écran d'appel/ }).click();
  const ajout = page.getByRole("region", { name: "Ajouter un écran" });
  await ajout.getByRole("textbox", { name: "Nom de l'écran" }).fill(nom);
  await ajout.getByRole("button", { name: "Ajouter l'écran" }).click();
  const lien = page.getByRole("region", { name: `Lien d'appairage de « ${nom} »` });
  const valeur = await lien.getByRole("textbox", { name: "Lien à transmettre" }).inputValue();
  expect(valeur).toMatch(new RegExp(`/ecran/${eglise.slug}#HKE1\\.[0-9A-Za-z]{43}$`));
  // The path and the fragment: the same server as the test, whatever the configured origin.
  const url = new URL(valeur);
  return `${url.pathname}${url.hash}`;
}

/** A separate device for the screen, with the project's options (and reduced motion or not). */
async function appareilEcran(browser: Browser, reducedMotion: "reduce" | "no-preference") {
  const { baseURL, locale, timezoneId, viewport } = test.info().project.use;
  const contexte = await browser.newContext({
    baseURL,
    locale,
    timezoneId,
    viewport,
    reducedMotion,
  });
  return { contexte, page: await contexte.newPage() };
}

/** Open session today, Ayo present: his parent is called to the reception desk. */
async function appelerParentDeAyo(eglise: EgliseIsolee) {
  const { enfantIds } = await eglise.creerFamille("Mensah", ["Ayo"]);
  await eglise.dansEglise(async (c) => {
    await c.query(
      `INSERT INTO "Session" (id, "egliseId", date, debut, fin, statut)
       VALUES ($1, $2, (now() AT TIME ZONE 'Africa/Porto-Novo')::date, now(),
               now() + interval '2 hours', 'OUVERTE')`,
      [`${eglise.id}_session`, eglise.id],
    );
    await c.query(
      `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut,
                               "codeRetrait", "checkinPar")
       VALUES ($1, $2, $3, $4, $5, 'PRESENT', 'K7MP', $6)`,
      [
        `${eglise.id}_presence`,
        eglise.id,
        `${eglise.id}_session`,
        enfantIds[0],
        `${eglise.id}_classe_3`,
        `${eglise.id}_accueil`,
      ],
    );
    await c.query(
      `INSERT INTO "Appel" (id, "egliseId", "presenceId", motif, lieu, "creePar")
       VALUES ($1, $2, $3, 'pleurs', 'Accueil enfants', $4)`,
      [`${eglise.id}_appel`, eglise.id, `${eglise.id}_presence`, `${eglise.id}_accueil`],
    );
  });
}

test("l'ADMIN appaire un écran ; un appel y apparaît en moins de 5 s, mis en évidence, sans nom ; l'écran retiré le dit", async ({
  page,
  browser,
  eglise,
}) => {
  const lien = await lienDAppairage(page, eglise, "Salle principale");
  const { contexte, page: ecran } = await appareilEcran(browser, "no-preference");
  await ecran.goto(lien);
  const tableau = ecran.getByRole("region", { name: "Écran d'appel" });
  await expect(tableau.getByRole("paragraph").filter({ hasText: "Aucun appel" })).toHaveText(
    "Aucun appel en cours.",
  );
  // The token left the address bar.
  expect(new URL(ecran.url()).hash).toBe("");

  const debut = Date.now();
  await appelerParentDeAyo(eglise);
  const tuile = tableau
    .getByRole("list", { name: "Appels" })
    .getByRole("listitem", { name: "HK-0001 · Accueil enfants" });
  await expect(tuile).toBeVisible({ timeout: 5000 });
  expect(Date.now() - debut).toBeLessThan(5000);
  await expect(tuile).toHaveAttribute("data-type", "appel");
  // A new tile stands out (animation), and the screen never shows a name (RG-10).
  expect(await tuile.evaluate((li) => getComputedStyle(li).animationName)).toBe("hk-apparition");
  await expect(tableau).not.toContainText("Ayo");
  await expect(tableau).not.toContainText("Mensah");

  // The admin sees when the screen was paired, then revokes it.
  await page.reload();
  const ligne = page.getByRole("list", { name: "Écrans" }).getByRole("listitem", {
    name: "Salle principale",
  });
  await expect(ligne).toHaveAccessibleDescription(/^Appairé · ajouté le .* · appairé le .*/);
  await ligne.getByRole("button", { name: "Retirer l'écran Salle principale" }).click();
  await page
    .getByRole("dialog", { name: "Retirer l'écran « Salle principale » ?" })
    .getByRole("button", { name: "Retirer l'écran" })
    .click();
  await expect(page.getByRole("status")).toHaveText("Écran « Salle principale » retiré.");

  // Inside the screen's region: Next.js keeps its own (empty) route announcer as an alert.
  await expect(tableau.getByRole("alert")).toHaveText(
    "Cet écran a été retiré : demandez un nouveau lien à l'administrateur.",
    { timeout: 10_000 },
  );
  // The link was used once: opening it again pairs nothing (a real load, not a hash change).
  await ecran.goto("about:blank");
  await ecran.goto(lien);
  await expect(tableau.getByRole("alert")).toHaveText(
    "Ce lien n'est plus valable : demandez un nouveau lien à l'administrateur de l'église.",
  );
  await contexte.close();
});

test("sans animation quand l'appareil demande moins de mouvement ; l'appareil d'une église ne voit rien d'une autre", async ({
  page,
  browser,
  eglise,
  autreEglise,
}) => {
  const lien = await lienDAppairage(page, eglise, "Hall");
  const { contexte, page: ecran } = await appareilEcran(browser, "reduce");
  await ecran.goto(lien);
  await appelerParentDeAyo(eglise);
  const tuile = ecran
    .getByRole("list", { name: "Appels" })
    .getByRole("listitem", { name: "HK-0001 · Accueil enfants" });
  await expect(tuile).toBeVisible({ timeout: 5000 });
  expect(await tuile.evaluate((li) => getComputedStyle(li).animationName)).toBe("none");

  // The same device on the other church's address: not paired there, nothing shown.
  await ecran.goto(`/ecran/${autreEglise.slug}`);
  await expect(ecran.getByRole("region", { name: "Écran d'appel" }).getByRole("alert")).toHaveText(
    "Cet écran n'est pas appairé à cette église : ouvrez sur cet appareil le lien donné par l'administrateur.",
  );
  expect((await ecran.request.get(`/api/ecran/${autreEglise.slug}`)).status()).toBe(404);
  // Without the cookie, the API refuses.
  expect((await page.request.get(`/api/ecran/${eglise.slug}`)).status()).toBe(401);
  await contexte.close();
});

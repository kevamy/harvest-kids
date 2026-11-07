import { createHash } from "node:crypto";
import {
  EGLISES,
  attendreAccueil,
  egliseDuProjet,
  email,
  reinitialiserLimites,
  seConnecter,
} from "./support/base";
import { expect, jetonDeTest, test, type EgliseIsolee } from "./support/eglise-isolee";

// Lot 2, step 3: check-in (cahier §7.3, RG-04, RG-05, RG-16, RG-17). Each test works in a
// church created for it; the 15-second criterion is measured on the production build (CI).
test.beforeEach(reinitialiserLimites);

const empreinte = (jeton: string) => createHash("sha256").update(jeton, "utf8").digest("hex");

/**
 * An open session today with the church's four classes (support/eglise-isolee.ts), the given
 * ones open (by order: 1 Pouponnière, 2 3–5 ans, 3 6–8 ans, 4 9–12 ans).
 */
const sessionOuverte = (eglise: EgliseIsolee, ouvertes: number[]) =>
  eglise.dansEglise(async (c) => {
    const sessionId = `${eglise.id}_session_du_jour`;
    await c.query(
      `INSERT INTO "Session" (id, "egliseId", date, debut, fin, statut)
       VALUES ($1, $2, (now() AT TIME ZONE 'Africa/Porto-Novo')::date, now(),
               now() + interval '2 hours', 'OUVERTE')`,
      [sessionId, eglise.id],
    );
    for (const ordre of [1, 2, 3, 4]) {
      await c.query(
        `INSERT INTO "SessionClasse" (id, "egliseId", "sessionId", "classeId", "ouverteLe")
         VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() END)`,
        [
          `${eglise.id}_sc_${ordre}`,
          eglise.id,
          sessionId,
          `${eglise.id}_classe_${ordre}`,
          ouvertes.includes(ordre),
        ],
      );
    }
  });

test("check-in d'une famille de 3 enfants en moins de 15 s, qui active sa nouvelle carte", async ({
  page,
  eglise,
}, testInfo) => {
  // Born in 2018, 2019 and 2020: all in "6–8 ans" (72 to 107 months).
  const { familleId } = await eglise.creerFamille("Trois", ["Ayo", "Sèna", "Koffi"]);
  const jeton = jetonDeTest("HKF1", eglise, "K");
  await eglise.dansEglise((c) =>
    c.query(
      `INSERT INTO "CarteFamille" (id, "egliseId", "familleId", "tokenHash") VALUES ($1, $2, $3, $4)`,
      [`${eglise.id}_carte_k`, eglise.id, familleId, empreinte(jeton)],
    ),
  );
  await sessionOuverte(eglise, [3]);

  await seConnecter(page, eglise.email("ACCUEIL"));
  await attendreAccueil(page, eglise.nom);
  const checkin = page.getByRole("tabpanel", { name: "Check-in" });
  const scan = checkin.getByRole("textbox", {
    name: "Scannez la carte famille ou saisissez le code",
  });
  // A handheld scanner works without touching the screen: the field has the focus.
  await expect(scan).toBeFocused();

  // From the scan to the confirmation (cahier §15: under 15 seconds).
  const debut = Date.now();
  await scan.fill(jeton);
  await scan.press("Enter");
  const famille = checkin.getByRole("region", { name: "Check-in de la famille Trois" });
  const enfants = famille.getByRole("list", { name: "Enfants de la famille" });
  for (const prenom of ["Ayo", "Sèna", "Koffi"]) {
    await expect(enfants.getByRole("checkbox", { name: prenom, exact: true })).toBeChecked();
    await expect(enfants.getByRole("combobox", { name: `Classe de ${prenom}` })).toHaveValue(
      `${eglise.id}_classe_3`,
    );
  }
  // The scan and the whole family fit on the screen, in both orientations, without scrolling.
  const enregistrer = famille.getByRole("button", { name: "Enregistrer l'arrivée" });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  for (const zone of [scan, ...(await enfants.getByRole("listitem").all()), enregistrer]) {
    await expect(zone).toBeInViewport({ ratio: 1 });
  }
  await page.screenshot({ path: testInfo.outputPath("capture-famille.png") });
  await enregistrer.click();
  const confirmation = checkin.getByRole("region", { name: "Arrivée enregistrée" });
  await expect(confirmation.getByRole("status")).toHaveText("Arrivée enregistrée.");
  const duree = Date.now() - debut;
  testInfo.annotations.push({ type: "check-in", description: `${duree} ms` });
  expect(duree).toBeLessThan(15_000);
  // The focus is back in the scan field for the next family.
  await expect(scan).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("capture-confirmation.png") });

  await expect(
    confirmation.getByRole("list", { name: "Enfants enregistrés" }).getByRole("listitem"),
  ).toHaveCount(3);
  const code = await confirmation.getByLabel(/^Code de retrait : /).textContent();
  expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}$/);

  // The pending card is active now (first check-in scan); one code for the family.
  const { rows } = await eglise.dansEglise((c) =>
    c.query(
      `SELECT (SELECT count(*)::int FROM "CarteFamille" WHERE "activeLe" IS NOT NULL) AS actives,
              (SELECT count(DISTINCT "codeRetrait")::int FROM "Presence") AS codes,
              (SELECT count(*)::int FROM "Presence" WHERE statut = 'PRESENT') AS presents`,
    ),
  );
  expect(rows[0]).toEqual({ actives: 1, codes: 1, presents: 3 });

  // "Famille suivante" by the Enter key: the screen is cleared, the scan keeps the focus.
  await scan.press("Enter");
  await expect(confirmation).toHaveCount(0);
  await expect(scan).toBeFocused();
});

test("une classe sans ses moniteurs bloque le check-in ; une famille à compléter renvoie à sa fiche", async ({
  page,
  eglise,
}) => {
  await eglise.creerFamille("Seule", ["Ayo"]);
  // A draft family (CSV import): no matricule.
  await eglise.dansEglise(async (c) => {
    await c.query(
      `INSERT INTO "Famille" (id, "egliseId", nom, "updatedAt") VALUES ($1, $2, 'Brouillon', now())`,
      [`${eglise.id}_brouillon`, eglise.id],
    );
    await c.query(
      `INSERT INTO "Enfant" (id, "egliseId", "familleId", prenom, nom, "dateNaissance", "updatedAt")
       VALUES ($1, $2, $3, 'Mawuli', 'Brouillon', '2019-04-01', now())`,
      [`${eglise.id}_brouillon_0`, eglise.id, `${eglise.id}_brouillon`],
    );
  });
  // "6–8 ans" stays closed (RG-05).
  await sessionOuverte(eglise, [1]);

  await seConnecter(page, eglise.email("ACCUEIL"));
  await attendreAccueil(page, eglise.nom);
  const checkin = page.getByRole("tabpanel", { name: "Check-in" });
  const recherche = checkin.getByRole("search", { name: "Rechercher une famille" });

  await recherche.getByRole("searchbox").fill("Seule");
  await recherche.getByRole("button", { name: "Rechercher" }).click();
  await checkin
    .getByRole("list", { name: "Familles trouvées" })
    .getByRole("button", { name: /^Famille Seule/ })
    .click();
  const famille = checkin.getByRole("region", { name: "Check-in de la famille Seule" });
  await famille.getByRole("button", { name: "Enregistrer l'arrivée" }).click();
  await expect(checkin.getByRole("alert")).toHaveText(
    "La classe 6–8 ans n'est pas ouverte : il lui faut ses moniteurs, ou une ouverture forcée par le responsable.",
  );

  await recherche.getByRole("searchbox").fill("Brouillon");
  await recherche.getByRole("button", { name: "Rechercher" }).click();
  await checkin
    .getByRole("list", { name: "Familles trouvées" })
    .getByRole("button", { name: /^Famille Brouillon/ })
    .click();
  const refus = checkin.getByRole("alert");
  await expect(refus).toContainText("Famille à compléter : finalisez l'inscription");
  await expect(
    refus.getByRole("link", { name: "Ouvrir la fiche pour la finaliser" }),
  ).toHaveAttribute("href", `/familles/${eglise.id}_brouillon`);

  const { rows } = await eglise.dansEglise((c) =>
    c.query(`SELECT count(*)::int AS n FROM "Presence"`),
  );
  expect(rows[0]).toEqual({ n: 0 });
});

test("le moniteur n'a pas de check-in à l'accueil", async ({ page }, testInfo) => {
  const eglise = egliseDuProjet(testInfo);
  await seConnecter(page, email("moniteur", eglise));
  await attendreAccueil(page, EGLISES[eglise]);
  await expect(page.getByRole("tablist", { name: "Poste d'accueil" })).toHaveCount(0);
  await expect(page.getByRole("tabpanel", { name: "Check-in" })).toHaveCount(0);
});

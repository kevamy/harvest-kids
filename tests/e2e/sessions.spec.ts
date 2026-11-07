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

// Lot 2, step 2: sessions and monitors (cahier §7.2, RG-05). Each test works in a church
// created for it (support/eglise-isolee.ts).
test.beforeEach(reinitialiserLimites);

/** A service today (the church's day of the week, read from PostgreSQL), 08:00 to 10:00. */
const culteDuJour = (eglise: EgliseIsolee) =>
  eglise.dansEglise((c) =>
    c.query(
      `INSERT INTO "Culte" (id, "egliseId", nom, jour, "heureDebut", "heureFin")
       VALUES ($1, $2, 'Culte du jour', extract(dow FROM (now() AT TIME ZONE 'Africa/Porto-Novo')::date)::int,
               '08:00', '10:00')`,
      [`${eglise.id}_culte_du_jour`, eglise.id],
    ),
  );

test("le responsable ouvre la session ; une classe s'ouvre au deuxième moniteur, ou forcée", async ({
  page,
  browser,
  eglise,
}) => {
  test.slow();
  await culteDuJour(eglise);
  // The monitor's badge, known to the test.
  const jeton = jetonDeTest("HKB1", eglise, "S");
  await eglise.dansEglise((c) =>
    c.query(
      `INSERT INTO "BadgeMoniteur" (id, "egliseId", "membreId", "tokenHash") VALUES ($1, $2, $3, $4)`,
      [
        `${eglise.id}_badge_s`,
        eglise.id,
        `${eglise.id}_moniteur_membre`,
        createHash("sha256").update(jeton, "utf8").digest("hex"),
      ],
    ),
  );

  await seConnecter(page, eglise.email("RESPONSABLE"));
  await attendreAccueil(page, eglise.nom);
  await page.getByRole("link", { name: "Sessions" }).click();
  const session = page.getByRole("region", { name: "Session Culte du jour" });
  await expect(
    session.getByRole("heading", { name: "Culte du jour · 08 h 00 – 10 h 00" }),
  ).toBeVisible();
  await session.getByRole("button", { name: "Ouvrir la session" }).click();
  const petits = session.getByRole("region", { name: "Classe 3–5 ans" });
  await expect(petits.getByText("Fermée : 0/2 moniteurs")).toBeVisible();

  // The monitor joins from their own tablet: one monitor is not enough (RG-05).
  // A second tablet: its own cookies, same server and locale as the project.
  const { baseURL, locale, timezoneId, viewport } = test.info().project.use;
  const tablette = await browser.newContext({ baseURL, locale, timezoneId, viewport });
  const moniteur = await tablette.newPage();
  await seConnecter(moniteur, eglise.email("MONITEUR"));
  await attendreAccueil(moniteur, eglise.nom);
  await moniteur.getByRole("link", { name: "Classes" }).click();
  const salle = moniteur.getByRole("region", { name: "Classe 3–5 ans" });
  await salle.getByRole("button", { name: "Rejoindre la classe" }).click();
  await expect(moniteur.getByRole("status")).toHaveText("Vous avez rejoint 3–5 ans.");
  await expect(salle.getByText("Fermée : 1/2 moniteurs")).toBeVisible();
  // The responsable's screen follows live.
  await expect(petits.getByText("Fermée : 1/2 moniteurs")).toBeVisible();

  // A second person, as a reinforcement: the class opens.
  await petits
    .getByLabel("Ajouter un moniteur")
    .selectOption({ label: "Infirmerie test (renfort)" });
  await petits.getByRole("button", { name: "Ajouter" }).click();
  await expect(petits.getByText("Ouverte", { exact: true })).toBeVisible();
  await expect(salle.getByText("Ouverte", { exact: true })).toBeVisible();

  // One leaves: the class stays open, in red.
  await petits.getByRole("button", { name: "Faire sortir" }).last().click();
  await expect(petits.getByText("Sous le minimum : 1/2 moniteurs")).toBeVisible();

  // The monitor's badge, scanned on the responsable's tablet, moves them to another class.
  await session.getByLabel("Scannez un badge moniteur").fill(jeton);
  await session.getByLabel("Scannez un badge moniteur").press("Enter");
  await expect(session.getByText("Badge de Moniteur test : choisissez sa classe.")).toBeVisible();
  const grands = session.getByRole("region", { name: "Classe 6–8 ans" });
  await grands.getByRole("button", { name: "Affecter Moniteur test" }).click();
  await expect(grands.getByText("Moniteur test")).toBeVisible();
  await expect(petits.getByText("Sous le minimum : 0/2 moniteurs")).toBeVisible();

  // Forced opening, with a reason.
  const pouponniere = session.getByRole("region", { name: "Classe Pouponnière" });
  await pouponniere.getByRole("button", { name: "Forcer l'ouverture" }).click();
  await pouponniere.getByLabel("Motif de l'ouverture forcée").fill("Deux mamans de garde ce matin");
  await pouponniere.getByRole("button", { name: "Confirmer l'ouverture forcée" }).click();
  await expect(pouponniere.getByText("Ouverte (forcée)")).toBeVisible();

  // No child present: the session closes.
  await session.getByRole("button", { name: "Clôturer la session" }).click();
  await expect(session.getByText("Clôturée", { exact: true })).toBeVisible();
  await tablette.close();
});

test("l'accueil n'a accès ni aux sessions ni aux classes", async ({ page }, testInfo) => {
  const eglise = egliseDuProjet(testInfo);
  await seConnecter(page, email("accueil", eglise));
  await attendreAccueil(page, EGLISES[eglise]);
  await expect(page.getByRole("link", { name: "Sessions" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Classes" })).toHaveCount(0);
  for (const chemin of ["/sessions", "/classe"]) {
    expect((await page.goto(chemin))?.status(), chemin).toBe(404);
  }
});

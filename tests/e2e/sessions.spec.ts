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
  // A class card is described by its state (aria-describedby).
  const petits = session.getByRole("region", { name: "Classe 3–5 ans" });
  await expect(petits).toHaveAccessibleDescription("Fermée : 0/2 moniteurs");

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
  await expect(
    moniteur.getByRole("region", { name: "Session Culte du jour" }).getByRole("status"),
  ).toHaveText("Vous avez rejoint 3–5 ans.");
  await expect(salle).toHaveAccessibleDescription("Fermée : 1/2 moniteurs");
  // The responsable's screen follows live.
  await expect(petits).toHaveAccessibleDescription("Fermée : 1/2 moniteurs");

  // The add list never offers someone already in the class, and says where the others are.
  const ajoutPetits = petits.getByRole("combobox", { name: "Ajouter un moniteur" });
  const grands = session.getByRole("region", { name: "Classe 6–8 ans" });
  const ajoutGrands = grands.getByRole("combobox", { name: "Ajouter un moniteur" });
  await expect(ajoutPetits.getByRole("option", { name: /^Moniteur test/ })).toHaveCount(0);
  await expect(
    ajoutGrands.getByRole("option", { name: "Moniteur test, dans 3–5 ans", exact: true }),
  ).toHaveCount(1);

  // A second person, as a reinforcement: the class opens.
  await ajoutPetits.selectOption({ label: "Infirmerie test (renfort)" });
  await petits.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(petits).toHaveAccessibleDescription("Ouverte");
  await expect(salle).toHaveAccessibleDescription("Ouverte");

  // One leaves: the class stays open, in red.
  const moniteursPetits = petits.getByRole("list", { name: "Moniteurs de 3–5 ans" });
  await moniteursPetits
    .getByRole("listitem")
    .filter({ hasText: "Infirmerie test" })
    .getByRole("button", { name: "Faire sortir" })
    .click();
  await expect(petits).toHaveAccessibleDescription("Sous le minimum : 1/2 moniteurs");

  // The monitor's badge, scanned on the responsable's tablet, moves them to another class.
  const scan = session.getByRole("textbox", { name: "Scannez un badge moniteur" });
  await scan.fill(jeton);
  await scan.press("Enter");
  await expect(
    session.getByRole("status").filter({ hasText: "Badge de Moniteur test" }),
  ).toContainText("Badge de Moniteur test : choisissez sa classe.");
  await grands.getByRole("button", { name: "Affecter Moniteur test" }).click();
  await expect(
    grands
      .getByRole("list", { name: "Moniteurs de 6–8 ans" })
      .getByRole("listitem")
      .filter({ hasText: "Moniteur test" }),
  ).toHaveCount(1);
  await expect(petits).toHaveAccessibleDescription("Sous le minimum : 0/2 moniteurs");
  // An open class left without any monitor: the highest alert, at the top of the board.
  const alertes = page.getByRole("region", { name: "Alertes des classes" });
  await expect(
    alertes.getByRole("listitem").filter({ hasText: "Aucun moniteur dans 3–5 ans" }),
  ).toHaveCount(1);

  // Forced opening: never without a monitor in the class (RG-05).
  const pouponniere = session.getByRole("region", { name: "Classe Pouponnière" });
  const forcer = async () => {
    await pouponniere.getByRole("button", { name: "Forcer l'ouverture" }).click();
    await pouponniere
      .getByRole("textbox", { name: "Motif de l'ouverture forcée" })
      .fill("Un seul moniteur, la responsable reste à côté");
    await pouponniere.getByRole("button", { name: "Confirmer l'ouverture forcée" }).click();
  };
  await forcer();
  await expect(session.getByRole("alert").filter({ hasText: "Affectez au moins" })).toHaveText(
    "Affectez au moins un moniteur avant de forcer l'ouverture.",
  );
  await expect(pouponniere).toHaveAccessibleDescription("Fermée : 0/2 moniteurs");

  await pouponniere
    .getByRole("combobox", { name: "Ajouter un moniteur" })
    .selectOption({ label: "Accueil test (renfort)" });
  await pouponniere.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(pouponniere).toHaveAccessibleDescription("Fermée : 1/2 moniteurs");
  await forcer();
  await expect(pouponniere).toHaveAccessibleDescription("Ouverture forcée : 1/2 moniteurs");
  await expect(pouponniere).toContainText(
    "Motif du forçage : Un seul moniteur, la responsable reste à côté",
  );

  // The forced class loses its only monitor: the highest alert.
  await pouponniere
    .getByRole("list", { name: "Moniteurs de Pouponnière" })
    .getByRole("listitem")
    .filter({ hasText: "Accueil test" })
    .getByRole("button", { name: "Faire sortir" })
    .click();
  await expect(
    alertes.getByRole("listitem").filter({ hasText: "Aucun moniteur dans Pouponnière" }),
  ).toHaveCount(1);

  // No child present: the session closes.
  await session.getByRole("button", { name: "Clôturer la session" }).click();
  await expect(session).toHaveAccessibleDescription("Clôturée");
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

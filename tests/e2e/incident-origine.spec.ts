import { writeFile } from "node:fs/promises";
import type { Browser } from "@playwright/test";
import { attendreAccueil, reinitialiserLimites, seConnecter } from "./support/base";
import { expect, test, type EgliseIsolee } from "./support/eglise-isolee";

// Lot 3 acceptance criterion (cahier §1 and §15): the original incident. A mother could not
// find her child, who was at the infirmerie without the reception desk knowing. Here, a child
// sent to the infirmerie is shown at the check-out and on the call screen in less than 5 s;
// the class door refuses to hand them over; a child not received raises the red alert; the
// reception desk hands them over and the screen clears. Each role on its own tablet.
test.beforeEach(reinitialiserLimites);

const LIMITE_MS = 5000;

/** A tablet of its own, with the project's options. */
async function tablette(
  browser: Browser,
  eglise: EgliseIsolee,
  role: Parameters<EgliseIsolee["email"]>[0],
) {
  const { baseURL, locale, timezoneId, viewport } = test.info().project.use;
  const contexte = await browser.newContext({ baseURL, locale, timezoneId, viewport });
  const page = await contexte.newPage();
  await seConnecter(page, eglise.email(role));
  await attendreAccueil(page, eglise.nom);
  return { contexte, page };
}

/**
 * Today's open session, "6–8 ans" open with the church's monitor, Ayo in class with the
 * code K7MP, his mother Afi authorised; the church allows the check-out at the class door.
 */
async function ayoEnSalle(eglise: EgliseIsolee) {
  const { familleId, enfantIds } = await eglise.creerFamille("Mensah", ["Ayo"]);
  const sessionId = `${eglise.id}_session_du_jour`;
  const sessionClasseId = `${eglise.id}_sc_3`;
  const presenceId = `${eglise.id}_presence_ayo`;
  await eglise.dansEglise(async (c) => {
    await c.query(
      `INSERT INTO "Session" (id, "egliseId", date, debut, fin, statut)
       VALUES ($1, $2, (now() AT TIME ZONE 'Africa/Porto-Novo')::date, now(),
               now() + interval '2 hours', 'OUVERTE')`,
      [sessionId, eglise.id],
    );
    await c.query(
      `INSERT INTO "SessionClasse" (id, "egliseId", "sessionId", "classeId", "ouverteLe")
       VALUES ($1, $2, $3, $4, now())`,
      [sessionClasseId, eglise.id, sessionId, `${eglise.id}_classe_3`],
    );
    await c.query(
      `INSERT INTO "AffectationMoniteur" (id, "egliseId", "sessionClasseId", "membreId")
       VALUES ($1, $2, $3, $4)`,
      [`${eglise.id}_aff`, eglise.id, sessionClasseId, `${eglise.id}_moniteur_membre`],
    );
    await c.query(
      `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut,
                               "codeRetrait", "checkinPar", "enSalleLe")
       VALUES ($1, $2, $3, $4, $5, 'EN_SALLE', 'K7MP', $6, now())`,
      [
        presenceId,
        eglise.id,
        sessionId,
        enfantIds[0],
        `${eglise.id}_classe_3`,
        `${eglise.id}_accueil`,
      ],
    );
    await c.query(
      `INSERT INTO "Tuteur" (id, "egliseId", "familleId", prenom, nom, lien, telephone, principal)
       VALUES ($1, $2, $3, 'Afi', 'Mensah', 'Mère', '+2290197451233', true)`,
      [`${familleId}_tuteur`, eglise.id, familleId],
    );
    await c.query(
      `INSERT INTO "PersonneAutorisee" (id, "egliseId", "familleId", prenom, nom, lien, "photoKey")
       VALUES ($1, $2, $3, 'Afi', 'Mensah', 'Mère', $4)`,
      [`${familleId}_afi`, eglise.id, familleId, `eglises/${eglise.id}/photos/afi.webp`],
    );
    await c.query(
      `INSERT INTO "Parametre" ("egliseId", cle, valeur)
       VALUES ($1, 'checkout.lieu', '"ACCUEIL_ET_CLASSES"')`,
      [eglise.id],
    );
  });
  return { sessionClasseId, presenceId };
}

test("scénario d'origine : un enfant envoyé à l'infirmerie est signalé au check-out et sur l'écran d'appel en moins de 5 s", async ({
  page,
  browser,
  eglise,
}, testInfo) => {
  test.slow();
  const { sessionClasseId, presenceId } = await ayoEnSalle(eglise);

  // 1. The ADMIN pairs the hall's screen; it shows no call.
  await seConnecter(page, eglise.email("ADMIN"));
  await attendreAccueil(page, eglise.nom);
  await page.goto("/parametres/ecran");
  const ajout = page.getByRole("region", { name: "Ajouter un écran" });
  await ajout.getByRole("textbox", { name: "Nom de l'écran" }).fill("Salle principale");
  await ajout.getByRole("button", { name: "Ajouter l'écran" }).click();
  const lien = new URL(
    await page
      .getByRole("region", { name: "Lien d'appairage de « Salle principale »" })
      .getByRole("textbox", { name: "Lien à transmettre" })
      .inputValue(),
  );
  const { baseURL, locale, timezoneId, viewport } = test.info().project.use;
  const salle = await browser.newContext({ baseURL, locale, timezoneId, viewport });
  const ecran = await salle.newPage();
  await ecran.goto(`${lien.pathname}${lien.hash}`);
  const tableau = ecran.getByRole("region", { name: "Écran d'appel" });
  await expect(tableau.getByRole("paragraph").filter({ hasText: "Aucun appel" })).toBeVisible();

  // The reception desk, its dashboard open; the monitor, on Ayo's card.
  const accueil = await tablette(browser, eglise, "ACCUEIL");
  const moniteur = await tablette(browser, eglise, "MONITEUR");
  await moniteur.page.goto(`/presences/${presenceId}`);
  const fiche = moniteur.page.getByRole("region", { name: "Fiche de Ayo" });
  const envoi = fiche.getByRole("region", { name: "Accompagner à l'infirmerie" });
  await envoi.getByRole("textbox", { name: "Motif" }).fill("Fièvre");

  // 2. Ayo leaves for the infirmerie: the clock starts at the click.
  const debut = Date.now();
  await envoi.getByRole("button", { name: "Accompagner Ayo à l'infirmerie" }).click();

  // 3. Reception dashboard and call screen, each within 5 s.
  const bandeAccueil = accueil.page.getByRole("region", { name: "Enfants à l'infirmerie" });
  await expect(bandeAccueil.getByRole("listitem")).toHaveText(
    /^Ayo \(HK-0001\) en route vers l'infirmerie · 6–8 ans · depuis \d+ min$/,
    { timeout: LIMITE_MS },
  );
  const tableauAccueilMs = Date.now() - debut;
  const tuile = tableau
    .getByRole("list", { name: "Appels" })
    .getByRole("listitem", { name: "HK-0001 · Infirmerie" });
  await expect(tuile).toBeVisible({ timeout: LIMITE_MS });
  await expect(tuile).toHaveAttribute("data-type", "infirmerie");
  const ecranMs = Date.now() - debut;
  await expect(tableau).not.toContainText("Ayo");
  await ecran.screenshot({ path: testInfo.outputPath("capture-ecran-infirmerie.png") });

  // 4. The mother arrives at the reception desk with her code: Ayo is announced first.
  await accueil.page
    .getByRole("tablist", { name: "Poste d'accueil" })
    .getByRole("tab", { name: "Check-out" })
    .click();
  const panneau = accueil.page.getByRole("tabpanel", { name: "Check-out" });
  const scan = panneau.getByRole("textbox", {
    name: "Scannez la carte ou saisissez le code de retrait",
  });
  await scan.fill("K7MP");
  await scan.press("Enter");
  const famille = panneau.getByRole("region", { name: "Retrait de la famille Mensah" });
  await expect(famille.getByRole("alert")).toHaveText(
    "Ayo est à l'infirmerie. Accompagnez le parent.",
  );
  const checkoutMs = Date.now() - debut;
  expect(tableauAccueilMs).toBeLessThan(LIMITE_MS);
  expect(ecranMs).toBeLessThan(LIMITE_MS);

  // 5. At the class door, the monitor cannot hand Ayo over.
  await moniteur.page.goto(`/classe/${sessionClasseId}`);
  const porte = moniteur.page.getByRole("region", { name: "Retrait à la porte de la classe" });
  const scanPorte = porte.getByRole("textbox", {
    name: "Scannez la carte ou saisissez le code de retrait",
  });
  await scanPorte.fill("K7MP");
  await scanPorte.press("Enter");
  const famillePorte = porte.getByRole("region", { name: "Retrait de la famille Mensah" });
  await expect(famillePorte.getByRole("alert")).toHaveText(
    "Ayo est à l'infirmerie : le retrait se fait à l'accueil. Accompagnez le parent.",
  );
  const ayoPorte = famillePorte
    .getByRole("list", { name: "Enfants à remettre" })
    .getByRole("listitem", { name: "Ayo" });
  await expect(ayoPorte.getByRole("checkbox", { name: "Ayo" })).toBeDisabled();
  await expect(ayoPorte).toHaveAccessibleDescription(
    "À l'infirmerie : le retrait se fait à l'accueil.",
  );

  // 6. Not received after the church's delay (5 min): red alert at the reception desk.
  await eglise.dansEglise((c) =>
    c.query(
      `UPDATE "Presence" SET "infirmerieLe" = "infirmerieLe" - interval '6 minutes'
       WHERE id = $1 AND "egliseId" = $2`,
      [presenceId, eglise.id],
    ),
  );
  await expect(bandeAccueil.getByRole("listitem")).toHaveText(
    /^Ayo n'est pas arrivé à l'infirmerie · 6–8 ans · parti il y a \d+ min$/,
    { timeout: LIMITE_MS },
  );

  // 7. The infirmerie receives him: the alert turns back to "at the infirmerie".
  const infirmerie = await tablette(browser, eglise, "INFIRMERIE");
  await infirmerie.page.goto("/infirmerie");
  await infirmerie.page
    .getByRole("list", { name: "Enfants en route" })
    .getByRole("listitem", { name: "Ayo" })
    .getByRole("button", { name: "Recevoir Ayo" })
    .click();
  await expect(bandeAccueil.getByRole("listitem")).toHaveText(
    /^Ayo \(HK-0001\) à l'infirmerie · 6–8 ans · depuis \d+ min$/,
    { timeout: LIMITE_MS },
  );

  // 8. The reception desk accompanies the mother and hands Ayo over; the screen clears.
  await scan.fill("K7MP");
  await scan.press("Enter");
  await famille
    .getByRole("group", { name: /^Qui récupère \?/ })
    .getByRole("radio", { name: "Afi Mensah Mère" })
    .check();
  await famille.getByRole("button", { name: "Confirmer le retrait" }).click();
  await expect(
    panneau.getByRole("region", { name: "Retrait confirmé" }).getByRole("status"),
  ).toHaveText("Retrait confirmé : Ayo remis à Afi Mensah.");
  await expect(tuile).toHaveCount(0, { timeout: LIMITE_MS });
  await expect(tableau.getByRole("paragraph").filter({ hasText: "Aucun appel" })).toBeVisible();

  const { rows } = await eglise.dansEglise((c) =>
    c.query(
      `SELECT type FROM "EvenementPresence" WHERE "egliseId" = $1 AND "presenceId" = $2
       ORDER BY "createdAt", id`,
      [eglise.id, presenceId],
    ),
  );
  expect(rows.map((r) => r.type)).toEqual(["infirmerie", "infirmerie_recue", "checkout"]);

  // Uploaded by the CI with the captures (artifact captures-e2e).
  await writeFile(
    testInfo.outputPath("mesure-incident-origine.txt"),
    `${testInfo.project.name} : tableau de l'accueil ${tableauAccueilMs} ms, écran d'appel ${ecranMs} ms, check-out (code saisi) ${checkoutMs} ms\n`,
  );
  for (const t of [salle, accueil.contexte, moniteur.contexte, infirmerie.contexte]) {
    await t.close();
  }
});

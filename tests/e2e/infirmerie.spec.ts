import { attendreAccueil, reinitialiserLimites, seConnecter } from "./support/base";
import { expect, test, type EgliseIsolee } from "./support/eglise-isolee";

// Lot 3, step 3: infirmerie (cahier §7.7, RG-07; decisions of 2026-11-24). Each test works in
// a church created for it; time passes by moving the stored dates back (database clock).
test.beforeEach(reinitialiserLimites);

/** Open session today, "6–8 ans" open with the church's monitor, Ayo in class. */
async function enfantEnSalle(eglise: EgliseIsolee) {
  const { enfantIds } = await eglise.creerFamille("Mensah", ["Ayo"]);
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
  });
  return { sessionClasseId, presenceId };
}

test("le moniteur accompagne Ayo ; non reçu après le délai, l'alerte rouge apparaît à l'infirmerie et à l'accueil ; reçu puis renvoyé, la classe confirme son retour", async ({
  page,
  browser,
  eglise,
}) => {
  const { sessionClasseId, presenceId } = await enfantEnSalle(eglise);

  // The monitor, from the child's card.
  await seConnecter(page, eglise.email("MONITEUR"));
  await attendreAccueil(page, eglise.nom);
  await page.goto(`/presences/${presenceId}`);
  const fiche = page.getByRole("region", { name: "Fiche de Ayo" });
  const envoi = fiche.getByRole("region", { name: "Accompagner à l'infirmerie" });
  await envoi.getByRole("textbox", { name: "Motif" }).fill("Fièvre");
  await envoi.getByRole("button", { name: "Accompagner Ayo à l'infirmerie" }).click();
  await expect(fiche.getByRole("status")).toHaveText("Ayo part à l'infirmerie.");
  await expect(fiche.getByRole("alert")).toHaveText(
    /^Ayo est en route vers l'infirmerie \(\d+ min\)\.$/,
  );
  await expect(fiche.getByRole("article")).toHaveAttribute("data-statut", "INFIRMERIE");
  // The monitor neither receives nor sends back.
  await expect(fiche.getByRole("button", { name: "Renvoyer en classe" })).toHaveCount(0);

  // Six minutes on the way (the church's delay is 5).
  await eglise.dansEglise((c) =>
    c.query(
      `UPDATE "Presence" SET "infirmerieLe" = "infirmerieLe" - interval '6 minutes'
       WHERE id = $1 AND "egliseId" = $2`,
      [presenceId, eglise.id],
    ),
  );

  const { baseURL, locale, timezoneId, viewport } = test.info().project.use;
  const tabletteAccueil = await browser.newContext({ baseURL, locale, timezoneId, viewport });
  const accueil = await tabletteAccueil.newPage();
  await seConnecter(accueil, eglise.email("ACCUEIL"));
  await attendreAccueil(accueil, eglise.nom);
  await expect(
    accueil.getByRole("region", { name: "Enfants à l'infirmerie" }).getByRole("listitem"),
  ).toHaveText(/^Ayo n'est pas arrivé à l'infirmerie · 6–8 ans · parti il y a \d+ min$/);

  const tabletteInfirmerie = await browser.newContext({ baseURL, locale, timezoneId, viewport });
  const infirmerie = await tabletteInfirmerie.newPage();
  await seConnecter(infirmerie, eglise.email("INFIRMERIE"));
  await attendreAccueil(infirmerie, eglise.nom);
  // exact: the alerts' links name the infirmerie too.
  await infirmerie.getByRole("link", { name: "Infirmerie", exact: true }).click();
  const liste = infirmerie.getByRole("region", { name: "Enfants à l'infirmerie" });
  await expect(liste.getByRole("alert").first()).toHaveText(
    /^Ayo n'est pas arrivé à l'infirmerie \(parti de 6–8 ans il y a \d+ min\)\.$/,
  );
  const ayo = liste.getByRole("list", { name: "Enfants en route" }).getByRole("listitem", {
    name: "Ayo",
  });
  await expect(ayo).toHaveAccessibleDescription(
    /^En route depuis \d+ min · accompagné par Moniteur test · Fièvre$/,
  );
  await ayo.getByRole("button", { name: "Recevoir Ayo" }).click();
  await expect(liste.getByRole("status")).toHaveText("Ayo est reçu à l'infirmerie.");
  // Received: the red alert is gone, here and at the reception desk.
  await expect(liste.getByRole("alert")).toHaveCount(0);
  await expect(
    accueil.getByRole("region", { name: "Enfants à l'infirmerie" }).getByRole("listitem"),
  ).toHaveText(/^Ayo \(HK-\d{4}\) à l'infirmerie · 6–8 ans · depuis \d+ min$/);

  const recu = liste.getByRole("list", { name: "Enfants reçus" }).getByRole("listitem", {
    name: "Ayo",
  });
  await recu.getByRole("button", { name: "Renvoyer Ayo en classe" }).click();
  await expect(liste.getByRole("status")).toHaveText(
    "Ayo est renvoyé en classe : la classe confirmera son arrivée.",
  );
  await expect(accueil.getByRole("region", { name: "Enfants à l'infirmerie" })).toHaveCount(0);

  // Back in the class list as "to confirm", never in class unseen.
  await page.goto(`/classe/${sessionClasseId}`);
  const classe = page.getByRole("region", { name: "Liste de 6–8 ans" });
  const aConfirmer = classe
    .getByRole("list", { name: "Enfants à confirmer" })
    .getByRole("listitem", { name: "Ayo" });
  await expect(aConfirmer).toHaveAccessibleDescription(
    /^Renvoyé de l'infirmerie il y a \d+ min : confirmez son arrivée$/,
  );
  await aConfirmer.getByRole("button", { name: "Confirmer l'arrivée de Ayo" }).click();
  await expect(classe.getByRole("status")).toHaveText("Arrivée de Ayo confirmée.");

  const { rows } = await eglise.dansEglise((c) =>
    c.query(
      `SELECT type FROM "EvenementPresence" WHERE "egliseId" = $1 AND "presenceId" = $2
       ORDER BY "createdAt", id`,
      [eglise.id, presenceId],
    ),
  );
  expect(rows.map((r) => r.type)).toEqual([
    "infirmerie",
    "infirmerie_recue",
    "infirmerie_retour",
    "en_salle",
  ]);
  await tabletteAccueil.close();
  await tabletteInfirmerie.close();
});

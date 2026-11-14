import { createHash } from "node:crypto";
import { attendreAccueil, reinitialiserLimites, seConnecter } from "./support/base";
import { expect, jetonDeTest, test, type EgliseIsolee } from "./support/eglise-isolee";

// Lot 2, step 4: arrival in class (cahier §7.4, ADR 0015). Each test works in a church
// created for it; times are moved by moving the stored dates back (database clock).
test.beforeEach(reinitialiserLimites);

const empreinte = (jeton: string) => createHash("sha256").update(jeton, "utf8").digest("hex");

/**
 * An open session today with the "6–8 ans" class open, the church's monitor assigned to it,
 * and a family of three children (born 2018 to 2020) checked in to that class. Returns the
 * class of the session.
 */
async function classeAvecFamille(eglise: EgliseIsolee) {
  const { familleId, enfantIds } = await eglise.creerFamille("Trois", ["Ayo", "Sèna", "Koffi"]);
  const sessionId = `${eglise.id}_session_du_jour`;
  const sessionClasseId = `${eglise.id}_sc_3`;
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
    // A medical alert, always shown in the class list.
    await c.query(`UPDATE "Enfant" SET alertes = '{ASTHME}' WHERE id = $1 AND "egliseId" = $2`, [
      enfantIds[0],
      eglise.id,
    ]);
    for (const [i, enfantId] of enfantIds.entries()) {
      await c.query(
        `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut,
                                 "codeRetrait", "checkinPar")
         VALUES ($1, $2, $3, $4, $5, 'PRESENT', 'K7MP', $6)`,
        [
          `${eglise.id}_presence_${i}`,
          eglise.id,
          sessionId,
          enfantId,
          `${eglise.id}_classe_3`,
          `${eglise.id}_accueil`,
        ],
      );
    }
  });
  return { familleId, sessionClasseId };
}

test("le moniteur confirme par toucher, annule son erreur dans la minute, puis confirme la famille par scan", async ({
  page,
  eglise,
}) => {
  const { familleId } = await classeAvecFamille(eglise);
  const jeton = jetonDeTest("HKF1", eglise, "S");
  // A pending card: the scan in class finds the family without activating it.
  await eglise.dansEglise((c) =>
    c.query(
      `INSERT INTO "CarteFamille" (id, "egliseId", "familleId", "tokenHash") VALUES ($1, $2, $3, $4)`,
      [`${eglise.id}_carte_s`, eglise.id, familleId, empreinte(jeton)],
    ),
  );

  await seConnecter(page, eglise.email("MONITEUR"));
  await attendreAccueil(page, eglise.nom);
  await page.goto("/classe");
  await page
    .getByRole("region", { name: "Classe 6–8 ans" })
    .getByRole("link", { name: "Ouvrir la liste de ma classe" })
    .click();

  const liste = page.getByRole("region", { name: "Liste de 6–8 ans" });
  const aConfirmer = liste.getByRole("list", { name: "Enfants à confirmer" });
  const enSalle = liste.getByRole("list", { name: "Enfants en salle" });
  await expect(aConfirmer.getByRole("listitem")).toHaveCount(3);
  const ayo = aConfirmer.getByRole("listitem", { name: "Ayo" });
  await expect(ayo.getByRole("list", { name: "Alertes médicales" })).toHaveText("Asthme");
  await expect(ayo).toHaveAccessibleDescription(/^Check-in à l'accueil il y a \d+ min$/);

  // A touch: Ayo goes down to "En salle".
  await ayo.getByRole("button", { name: "Confirmer l'arrivée de Ayo" }).click();
  await expect(liste.getByRole("status")).toHaveText("Arrivée de Ayo confirmée.");
  await expect(aConfirmer.getByRole("listitem", { name: "Ayo" })).toHaveCount(0);
  const ayoEnSalle = enSalle.getByRole("listitem", { name: "Ayo" });
  await expect(ayoEnSalle.getByRole("article")).toHaveAttribute("data-statut", "EN_SALLE");

  // A wrong touch is undone within the minute, by the monitor who confirmed.
  await ayoEnSalle.getByRole("button", { name: "Annuler l'arrivée de Ayo" }).click();
  await expect(liste.getByRole("status")).toHaveText(
    "Arrivée de Ayo annulée : à confirmer de nouveau.",
  );
  await expect(aConfirmer.getByRole("listitem")).toHaveCount(3);

  // The family card scanned at the door: the three children at once.
  const scan = liste.getByRole("textbox", {
    name: "Scannez la carte de l'enfant ou de la famille",
  });
  await scan.fill(jeton);
  await scan.press("Enter");
  await expect(liste.getByRole("status")).toHaveText("Arrivées de Ayo, Sèna et Koffi confirmées.");
  await expect(enSalle.getByRole("listitem")).toHaveCount(3);
  await expect(liste.getByRole("list", { name: "Enfants à confirmer" })).toHaveCount(0);

  const { rows } = await eglise.dansEglise((c) =>
    c.query(
      `SELECT (SELECT count(*)::int FROM "Presence"
                WHERE "egliseId" = $1 AND statut = 'EN_SALLE') AS "enSalle",
              (SELECT count(*)::int FROM "CarteFamille"
                WHERE "egliseId" = $1 AND "activeLe" IS NOT NULL) AS actives,
              (SELECT count(*)::int FROM "EvenementPresence"
                WHERE "egliseId" = $1 AND type = 'en_salle_annulee') AS annulations`,
      [eglise.id],
    ),
  );
  expect(rows[0]).toEqual({ enSalle: 3, actives: 0, annulations: 1 });
});

test("après la minute, seul le responsable corrige, avec un motif ; l'accueil voit l'enfant pas encore en salle", async ({
  browser,
  eglise,
}) => {
  test.slow();
  const { sessionClasseId } = await classeAvecFamille(eglise);
  // Ayo confirmed by the monitor 2 minutes ago; Sèna checked in 15 minutes ago, still on her way.
  await eglise.dansEglise(async (c) => {
    await c.query(
      `UPDATE "Presence" SET statut = 'EN_SALLE', "enSalleLe" = now() - interval '2 minutes'
       WHERE id = $1 AND "egliseId" = $2`,
      [`${eglise.id}_presence_0`, eglise.id],
    );
    await c.query(
      `INSERT INTO "EvenementPresence" (id, "egliseId", "presenceId", type, "userId", "createdAt")
       VALUES ($1, $2, $3, 'en_salle', $4, now() - interval '2 minutes')`,
      [`${eglise.id}_ev`, eglise.id, `${eglise.id}_presence_0`, `${eglise.id}_moniteur`],
    );
    await c.query(
      `UPDATE "Presence" SET "checkinLe" = "checkinLe" - interval '15 minutes'
       WHERE id = $1 AND "egliseId" = $2`,
      [`${eglise.id}_presence_1`, eglise.id],
    );
  });
  const ouvrir = async (role: "MONITEUR" | "RESPONSABLE" | "ACCUEIL") => {
    const contexte = await browser.newContext();
    const page = await contexte.newPage();
    await seConnecter(page, eglise.email(role));
    await attendreAccueil(page, eglise.nom);
    return page;
  };

  // The monitor: the minute is over, no "Annuler"; Sèna is flagged.
  const moniteur = await ouvrir("MONITEUR");
  await moniteur.goto(`/classe/${sessionClasseId}`);
  const listeMoniteur = moniteur.getByRole("region", { name: "Liste de 6–8 ans" });
  await expect(
    listeMoniteur.getByRole("list", { name: "Enfants en salle" }).getByRole("listitem", {
      name: "Ayo",
    }),
  ).toBeVisible();
  await expect(listeMoniteur.getByRole("button", { name: "Annuler l'arrivée de Ayo" })).toHaveCount(
    0,
  );
  await expect(
    listeMoniteur
      .getByRole("list", { name: "Enfants à confirmer" })
      .getByRole("listitem", { name: "Sèna" }),
  ).toHaveAccessibleDescription(/^Toujours pas en salle : check-in à l'accueil il y a 1\d min$/);

  // The reception desk: the "not arrived in class" alert names Sèna and her class.
  const accueil = await ouvrir("ACCUEIL");
  await expect(
    accueil
      .getByRole("region", { name: "Enfants pas encore en salle" })
      .getByRole("listitem")
      .filter({ hasText: "Sèna" }),
  ).toHaveText(/^Sèna \(HK-\d{4}\) pas encore en salle · 6–8 ans · depuis 1\d min$/);

  // The RESPONSABLE, not assigned: sees the class, confirms nothing, corrects with a reason.
  const responsable = await ouvrir("RESPONSABLE");
  await responsable.goto(`/classe/${sessionClasseId}`);
  const liste = responsable.getByRole("region", { name: "Liste de 6–8 ans" });
  await expect(liste.getByRole("list", { name: "Enfants à confirmer" })).toBeVisible();
  await expect(liste.getByRole("button", { name: /^Confirmer l'arrivée de / })).toHaveCount(0);
  await expect(liste.getByRole("textbox", { name: /^Scannez/ })).toHaveCount(0);
  await liste.getByRole("button", { name: "Corriger l'arrivée de Ayo" }).click();
  const correction = liste.getByRole("form", { name: "Correction de l'arrivée de Ayo" });
  await correction
    .getByRole("textbox", { name: "Motif de la correction" })
    .fill("Touché par erreur, Ayo est aux toilettes");
  await correction.getByRole("button", { name: "Remettre à confirmer" }).click();
  await expect(liste.getByRole("status")).toHaveText(
    "Arrivée de Ayo corrigée : à confirmer de nouveau.",
  );
  await expect(
    liste.getByRole("list", { name: "Enfants à confirmer" }).getByRole("listitem", { name: "Ayo" }),
  ).toBeVisible();

  for (const page of [moniteur, accueil, responsable]) await page.context().close();
});

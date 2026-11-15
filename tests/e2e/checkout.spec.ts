import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { PIN, alerte, attendreAccueil, reinitialiserLimites, seConnecter } from "./support/base";
import { expect, jetonDeTest, test, type EgliseIsolee } from "./support/eglise-isolee";

// Lot 2, step 5a: check-out at the reception desk (cahier §7.6, RG-04, RG-06). Each test
// works in a church created for it.
test.beforeEach(reinitialiserLimites);

const empreinte = (jeton: string) => createHash("sha256").update(jeton, "utf8").digest("hex");

/**
 * An open session today with the "6–8 ans" class, and a family whose children are checked in
 * with the retrieval code given (Ayo in class, Sèna still on her way), a main contact and an
 * authorised person, Afi.
 */
async function familleAuCulte(eglise: EgliseIsolee, nom: string, code: string) {
  const { familleId, enfantIds } = await eglise.creerFamille(nom, ["Ayo", "Sèna"]);
  const sessionId = `${eglise.id}_session_du_jour`;
  await eglise.dansEglise(async (c) => {
    await c.query(
      `INSERT INTO "Session" (id, "egliseId", date, debut, fin, statut)
       VALUES ($1, $2, (now() AT TIME ZONE 'Africa/Porto-Novo')::date, now(),
               now() + interval '2 hours', 'OUVERTE')
       ON CONFLICT (id) DO NOTHING`,
      [sessionId, eglise.id],
    );
    for (const [i, enfantId] of enfantIds.entries()) {
      await c.query(
        `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut,
                                 "codeRetrait", "checkinPar")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          `${enfantId}_presence`,
          eglise.id,
          sessionId,
          enfantId,
          `${eglise.id}_classe_3`,
          i === 0 ? "EN_SALLE" : "PRESENT",
          code,
          `${eglise.id}_accueil`,
        ],
      );
    }
    await c.query(
      `INSERT INTO "Tuteur" (id, "egliseId", "familleId", prenom, nom, lien, telephone, principal)
       VALUES ($1, $2, $3, 'Afi', $4, 'Mère', '+2290197451233', true)`,
      [`${familleId}_tuteur`, eglise.id, familleId, nom],
    );
    await c.query(
      `INSERT INTO "PersonneAutorisee" (id, "egliseId", "familleId", prenom, nom, lien, "photoKey")
       VALUES ($1, $2, $3, 'Afi', $4, 'Mère', $5)`,
      [`${familleId}_afi`, eglise.id, familleId, nom, `eglises/${eglise.id}/photos/afi.webp`],
    );
  });
  return { familleId };
}

async function ouvrirCheckout(page: Page, eglise: EgliseIsolee) {
  await seConnecter(page, eglise.email("ACCUEIL"));
  await attendreAccueil(page, eglise.nom);
  await page
    .getByRole("tablist", { name: "Poste d'accueil" })
    .getByRole("tab", { name: "Check-out" })
    .click();
  const panneau = page.getByRole("tabpanel", { name: "Check-out" });
  const scan = panneau.getByRole("textbox", {
    name: "Scannez la carte ou saisissez le code de retrait",
  });
  await expect(scan).toBeFocused();
  return { panneau, scan };
}

test("check-out autorisé : la carte scannée, la photo de la personne touchée, le retrait confirmé", async ({
  page,
  eglise,
}) => {
  const { familleId } = await familleAuCulte(eglise, "Trois", "K7MP");
  const jeton = jetonDeTest("HKF1", eglise, "R");
  await eglise.dansEglise((c) =>
    c.query(
      `INSERT INTO "CarteFamille" (id, "egliseId", "familleId", "tokenHash", "activeLe")
       VALUES ($1, $2, $3, $4, now())`,
      [`${eglise.id}_carte_r`, eglise.id, familleId, empreinte(jeton)],
    ),
  );

  const { panneau, scan } = await ouvrirCheckout(page, eglise);
  await scan.fill(jeton);
  await scan.press("Enter");

  const famille = panneau.getByRole("region", { name: "Retrait de la famille Trois" });
  const enfants = famille.getByRole("list", { name: "Enfants à remettre" });
  const ayo = enfants.getByRole("listitem", { name: "Ayo" });
  const sena = enfants.getByRole("listitem", { name: "Sèna" });
  await expect(ayo.getByRole("checkbox", { name: "Ayo" })).toBeChecked();
  await expect(ayo).toHaveAccessibleDescription(
    "En salle : 6–8 ans. Demandez à la classe de l'amener, ou accompagnez le parent.",
  );
  await expect(sena).toHaveAccessibleDescription(
    "Pas encore en salle : en route vers 6–8 ans. Allez le chercher avec le parent.",
  );

  // A right card never suffices: the retrieval waits for the photo of the adult.
  const confirmer = famille.getByRole("button", { name: "Confirmer le retrait" });
  await expect(confirmer).toBeDisabled();
  await famille
    .getByRole("group", { name: /^Qui récupère \?/ })
    .getByRole("radio", { name: "Afi Trois Mère" })
    .check();
  await confirmer.click();

  const confirmation = panneau.getByRole("region", { name: "Retrait confirmé" });
  await expect(confirmation.getByRole("status")).toHaveText(
    "Retrait confirmé : Ayo et Sèna remis à Afi Trois.",
  );
  await expect(scan).toBeFocused();
  const { rows } = await eglise.dansEglise((c) =>
    c.query(
      `SELECT count(*)::int AS n FROM "Presence"
       WHERE "egliseId" = $1 AND statut = 'RECUPERE' AND "recuperePar" = $2`,
      [eglise.id, `${familleId}_afi`],
    ),
  );
  expect(rows[0]).toEqual({ n: 2 });
});

test("ni carte ni code : la famille cherchée par son nom, un collègue confirme avec son PIN", async ({
  page,
  eglise,
}) => {
  const { familleId } = await familleAuCulte(eglise, "Quatre", "MNPQ");
  const { panneau } = await ouvrirCheckout(page, eglise);

  const recherche = panneau.getByRole("search", {
    name: "Rechercher une famille sans carte ni code",
  });
  await recherche.getByRole("searchbox").fill("Quatre");
  await recherche.getByRole("button", { name: "Rechercher" }).click();
  await panneau
    .getByRole("list", { name: "Familles trouvées" })
    .getByRole("button", { name: /^Famille Quatre/ })
    .click();

  const famille = panneau.getByRole("region", { name: "Retrait de la famille Quatre" });
  await famille
    .getByRole("group", { name: /^Qui récupère \?/ })
    .getByRole("radio", { name: "Afi Quatre Mère" })
    .check();
  await famille.getByRole("button", { name: "Faire confirmer par un collègue" }).click();

  const confirmation = famille.getByRole("form", { name: "Confirmation par un second membre" });
  // The agent is not offered: the confirmation comes from someone else.
  await expect(
    confirmation.getByRole("combobox", { name: "Second membre" }).getByRole("option", {
      name: "Accueil test",
    }),
  ).toHaveCount(0);
  await confirmation
    .getByRole("combobox", { name: "Second membre" })
    .selectOption({ label: "Responsable test" });
  await confirmation.getByLabel("Son code PIN").fill("111222");
  await confirmation.getByRole("button", { name: "Confirmer le retrait" }).click();
  await expect(alerte(page, "PIN incorrect")).toHaveText("PIN incorrect. Encore 4 essais.");

  await confirmation.getByLabel("Son code PIN").fill(PIN);
  await confirmation.getByRole("button", { name: "Confirmer le retrait" }).click();
  await expect(
    panneau.getByRole("region", { name: "Retrait confirmé" }).getByRole("status"),
  ).toHaveText("Retrait confirmé : Ayo et Sèna remis à Afi Quatre.");

  const { rows } = await eglise.dansEglise((c) =>
    c.query(
      `SELECT DISTINCT detail->>'carte' AS carte, detail->>'secondMembre' AS "secondMembre"
       FROM "EvenementPresence" e JOIN "Presence" p ON p.id = e."presenceId"
       JOIN "Enfant" x ON x.id = p."enfantId"
       WHERE e."egliseId" = $1 AND e.type = 'checkout' AND x."familleId" = $2`,
      [eglise.id, familleId],
    ),
  );
  expect(rows).toEqual([{ carte: "recherche", secondMembre: `${eglise.id}_responsable` }]);
});

// A 1×1 PNG: the "photo" taken by the tablet's camera in the test.
const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("retrait exceptionnel : le responsable autorise avec son PIN, l'incident garde la photo pour lui seul", async ({
  page,
  browser,
  eglise,
}) => {
  test.slow();
  await familleAuCulte(eglise, "Cinq", "WXYZ");
  const { panneau, scan } = await ouvrirCheckout(page, eglise);
  await scan.fill("WXYZ");
  await scan.press("Enter");

  const famille = panneau.getByRole("region", { name: "Retrait de la famille Cinq" });
  await famille.getByRole("button", { name: "Personne non reconnue" }).click();
  await famille
    .getByRole("region", { name: "Personne non reconnue" })
    .getByRole("button", { name: "Retrait exceptionnel avec le responsable" })
    .click();

  const formulaire = famille.getByRole("form", { name: "Retrait exceptionnel" });
  await formulaire.getByRole("textbox", { name: "Nom de l'adulte" }).fill("Kossi Cinq");
  await formulaire.getByRole("textbox", { name: "Motif" }).fill("La mère a confirmé par téléphone");
  const photo = formulaire.getByLabel("Photo de l'adulte");
  await expect(photo).toHaveAccessibleDescription(
    "Prévenez la personne que sa photo est prise pour la sécurité de l'enfant.",
  );
  await photo.setInputFiles({ name: "adulte.png", mimeType: "image/png", buffer: PHOTO });
  await expect(formulaire.getByRole("img", { name: "Photo prise" })).toBeVisible();
  await formulaire
    .getByRole("combobox", { name: "Responsable qui autorise" })
    .selectOption({ label: "Responsable test" });
  await formulaire.getByLabel("Code PIN du responsable").fill(PIN);
  await formulaire.getByRole("button", { name: "Autoriser le retrait exceptionnel" }).click();

  await expect(
    panneau.getByRole("region", { name: "Retrait exceptionnel enregistré" }).getByRole("status"),
  ).toHaveText(
    "Retrait exceptionnel enregistré : Ayo et Sèna remis à Kossi Cinq. Un incident est créé pour le responsable.",
  );

  // The photo: never for the reception desk, even by its URL.
  const { rows } = await eglise.dansEglise((c) =>
    c.query(`SELECT "photoKey" FROM "RetraitExceptionnel" WHERE "egliseId" = $1`, [eglise.id]),
  );
  const photoKey = (rows[0] as { photoKey: string }).photoKey;
  expect((await page.request.get(`/api/fichiers/${photoKey}`)).status()).toBe(404);

  // The RESPONSABLE: the incident in the list, without photo; the photo in its detail.
  const contexte = await browser.newContext();
  const responsable = await contexte.newPage();
  await seConnecter(responsable, eglise.email("RESPONSABLE"));
  await attendreAccueil(responsable, eglise.nom);
  await responsable.goto("/incidents");
  const incidents = responsable.getByRole("list", { name: "Incidents" });
  await expect(incidents.getByRole("img")).toHaveCount(0);
  await incidents.getByRole("link", { name: /^Retrait par une personne non autorisée · / }).click();
  const retrait = responsable.getByRole("region", { name: "Retrait exceptionnel" });
  const image = retrait.getByRole("img", { name: "Photo de Kossi Cinq" });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(
    retrait.getByRole("list", { name: "Enfants remis" }).getByRole("listitem"),
  ).toHaveCount(2);
  await contexte.close();
});

test("check-out refusé : un code erroné est compté, un adulte non reconnu bloque le retrait", async ({
  page,
  eglise,
}) => {
  await familleAuCulte(eglise, "Deux", "QRST");
  const { panneau, scan } = await ouvrirCheckout(page, eglise);

  // A wrong code: refused, counted against the tablet (5 per session in 15 minutes).
  await scan.fill("ZZZZ");
  await scan.press("Enter");
  await expect(alerte(page, "Ce code ne correspond")).toHaveText(
    "Ce code ne correspond à aucune famille de cette session : vérifiez-le avec le parent, ou scannez sa carte. Encore 4 essais avant le blocage de la tablette.",
  );

  // The right code (lower case accepted): the family, but the adult is not among the photos.
  await scan.fill("qrst");
  await scan.press("Enter");
  const famille = panneau.getByRole("region", { name: "Retrait de la famille Deux" });
  await famille.getByRole("button", { name: "Personne non reconnue" }).click();
  const blocage = famille.getByRole("region", { name: "Personne non reconnue" });
  await expect(blocage.getByRole("alert")).toHaveText(
    "Retrait bloqué : cet adulte n'est pas parmi les personnes autorisées. Appelez le contact principal ; le responsable peut ensuite autoriser un retrait exceptionnel.",
  );
  await expect(blocage.getByRole("link", { name: "Appeler Afi" })).toHaveAttribute(
    "href",
    "tel:+2290197451233",
  );
  await expect(blocage.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
    "href",
    "https://wa.me/2290197451233",
  );
  await expect(famille.getByRole("button", { name: "Confirmer le retrait" })).toBeDisabled();

  const { rows } = await eglise.dansEglise((c) =>
    c.query(
      `SELECT (SELECT count(*)::int FROM "Presence"
                WHERE "egliseId" = $1 AND statut = 'RECUPERE') AS recuperes,
              (SELECT count(*)::int FROM "AuditLog"
                WHERE "egliseId" = $1 AND action = 'checkout.code_errone') AS erreurs`,
      [eglise.id],
    ),
  );
  expect(rows[0]).toEqual({ recuperes: 0, erreurs: 1 });
});

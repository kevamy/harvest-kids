import { attendreAccueil, reinitialiserLimites, seConnecter } from "./support/base";
import { expect, test, type EgliseIsolee } from "./support/eglise-isolee";

// Lot 3, step 2: a child's presence card and the Urgence button (cahier §7.9, ADR 0019).
// Each test works in a church created for it.
test.beforeEach(reinitialiserLimites);

/**
 * An open session today with the "6–8 ans" class open, the church's monitor assigned to it,
 * and Ayo checked in to it; the mother is the main contact, with a WhatsApp number.
 */
async function enfantEnClasse(eglise: EgliseIsolee) {
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
      `INSERT INTO "Tuteur" (id, "egliseId", "familleId", prenom, nom, lien, telephone, whatsapp, principal)
       VALUES ($1, $2, $3, 'Afi', 'Mensah', 'Mère', '+2290197451233', '+2290166000001', true)`,
      [`${eglise.id}_tuteur`, eglise.id, familleId],
    );
    await c.query(
      `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut,
                               "codeRetrait", "checkinPar")
       VALUES ($1, $2, $3, $4, $5, 'PRESENT', 'K7MP', $6)`,
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

test("le moniteur ouvre la fiche depuis sa classe, appelle la mère : l'appel est journalisé, son résultat noté une fois", async ({
  page,
  eglise,
}) => {
  const { sessionClasseId, presenceId } = await enfantEnClasse(eglise);
  await seConnecter(page, eglise.email("MONITEUR"));
  await attendreAccueil(page, eglise.nom);
  await page.goto(`/classe/${sessionClasseId}`);
  await page
    .getByRole("region", { name: "Liste de 6–8 ans" })
    .getByRole("listitem", { name: "Ayo" })
    .getByRole("link", { name: "Fiche de Ayo" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/presences/${presenceId}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ayo Mensah");

  const fiche = page.getByRole("region", { name: "Fiche de Ayo" });
  await expect(fiche.getByRole("article")).toHaveAttribute("data-statut", "PRESENT");
  const urgence = fiche.getByRole("region", { name: "Urgence" });
  const mere = urgence
    .getByRole("list", { name: "Contacts de la famille" })
    .getByRole("listitem", { name: "Afi Mensah" });
  const appel = mere.getByRole("link", { name: "Appeler Afi au +229 01 97 45 12 33" });
  await expect(appel).toHaveAttribute("href", "tel:+2290197451233");
  await expect(mere.getByRole("link", { name: "Écrire à Afi sur WhatsApp" })).toHaveAttribute(
    "href",
    "https://wa.me/2290166000001",
  );

  // The tablet's phone app is out of the test: the tel: navigation is cancelled before the
  // browser handles it, the page's own click handler (the log) still runs.
  await page.evaluate(() =>
    window.addEventListener(
      "click",
      (e) => {
        if ((e.target as Element).closest('a[href^="tel:"]')) e.preventDefault();
      },
      true,
    ),
  );
  await appel.click();

  const journal = fiche.getByRole("list", { name: "Appels passés" });
  const ligne = journal.getByRole("listitem", { name: /^Appel à Afi Mensah, \d{2}:\d{2}$/ });
  await expect(ligne).toHaveAccessibleDescription("Résultat à noter");
  await ligne.getByRole("button", { name: "Pas de réponse" }).click();
  await expect(fiche.getByRole("status")).toHaveText("Résultat noté : Pas de réponse.");
  await expect(ligne).toHaveAccessibleDescription("Résultat : Pas de réponse");
  await expect(ligne.getByRole("button")).toHaveCount(0);

  const { rows } = await eglise.dansEglise((c) =>
    c.query(
      `SELECT numero, canal, resultat, "resultatLe" IS NOT NULL AS "resultatDate"
       FROM "AppelTelephonique" WHERE "egliseId" = $1`,
      [eglise.id],
    ),
  );
  expect(rows).toEqual([
    { numero: "+2290197451233", canal: "tel", resultat: "pas_de_reponse", resultatDate: true },
  ]);
});

test("la fiche d'un enfant d'une autre église répond 404", async ({
  page,
  eglise,
  autreEglise,
}) => {
  const { presenceId } = await enfantEnClasse(eglise);
  await seConnecter(page, autreEglise.email("ADMIN"));
  await attendreAccueil(page, autreEglise.nom);
  expect((await page.goto(`/presences/${presenceId}`))?.status()).toBe(404);
  expect((await page.request.get(`/api/direct/presences/${presenceId}`)).status()).toBe(404);
});

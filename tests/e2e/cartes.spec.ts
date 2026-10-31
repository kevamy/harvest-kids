import { createHash, randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  EGLISES,
  attendreAccueil,
  avecBase,
  egliseDuProjet,
  email,
  reinitialiserLimites,
  seConnecter,
} from "./support/base";

const NOM = "E2E Cartes";
const empreinte = (jeton: string) => createHash("sha256").update(jeton, "utf8").digest("hex");
const jeton = (lettre: string) => `HKF1.${lettre.repeat(22)}`;

const idEglise = (nom: string) =>
  avecBase(
    async (c) =>
      (await c.query<{ id: string }>(`SELECT id FROM "Eglise" WHERE nom = $1`, [nom])).rows[0]!.id,
  );

/** Runs SQL inside a church, as the owner (FORCE RLS applies to the owner too). */
async function dansEglise(
  nomEglise: string,
  fn: (c: import("pg").Client, egliseId: string) => Promise<void>,
) {
  const egliseId = await idEglise(nomEglise);
  await avecBase(async (c) => {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.eglise_id', $1, true)", [egliseId]);
    await fn(c, egliseId);
    await c.query("COMMIT");
  });
}

/** A finalised test family with its children (one by default) and no card. */
async function creerFamille(nomEglise: string, prenoms = ["Ayo"]) {
  let familleId = "";
  await dansEglise(nomEglise, async (c, egliseId) => {
    familleId = `e2e_famille_${randomInt(1e9)}`;
    await c.query(
      `INSERT INTO "Famille" (id, "egliseId", nom, "consentementDonnees", "finaliseeLe", "updatedAt")
       VALUES ($1, $2, $3, now(), now(), now())`,
      [familleId, egliseId, NOM],
    );
    for (const [i, prenom] of prenoms.entries()) {
      await c.query(
        `INSERT INTO "Enfant" (id, "egliseId", matricule, "familleId", prenom, nom, "dateNaissance", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'Cartes', $6, now())`,
        [
          i === 0 ? `${familleId}_e` : `${familleId}_e${i}`,
          egliseId,
          `HK-9${String(randomInt(1e4)).padStart(4, "0")}`,
          familleId,
          prenom,
          `${2018 + i}-01-01`,
        ],
      );
    }
  });
  return familleId;
}

/**
 * State of the church's cards, reissues and card mode, taken before a bulk reissue (which
 * touches every family of the demonstration church) and put back after it. The e2e suite
 * runs on one worker (CI and locally): no other test changes cards meanwhile.
 */
async function instantaneCartes(nomEglise: string) {
  // Dates kept as text: written back exactly, whatever the machine's time zone.
  let etat: {
    cartes: { id: string; activeLe: string | null; revoqueeLe: string | null }[];
    reemissions: string[];
  } = { cartes: [], reemissions: [] };
  await dansEglise(nomEglise, async (c) => {
    etat = {
      cartes: (
        await c.query(
          `SELECT id, "activeLe"::text AS "activeLe", "revoqueeLe"::text AS "revoqueeLe" FROM "CarteFamille"`,
        )
      ).rows,
      reemissions: (await c.query(`SELECT id FROM "ReemissionCartes"`)).rows.map((r) => r.id),
    };
  });
  return () =>
    dansEglise(nomEglise, async (c) => {
      const ids = etat.cartes.map((carte) => carte.id);
      await c.query(`DELETE FROM "CarteFamille" WHERE NOT (id = ANY($1))`, [ids]);
      for (const carte of etat.cartes) {
        await c.query(
          `UPDATE "CarteFamille" SET "activeLe" = $2::timestamp, "revoqueeLe" = $3::timestamp WHERE id = $1`,
          [carte.id, carte.activeLe, carte.revoqueeLe],
        );
      }
      await c.query(`DELETE FROM "ReemissionCartes" WHERE NOT (id = ANY($1))`, [etat.reemissions]);
      await c.query(`DELETE FROM "Parametre" WHERE cle = 'cartes.mode'`);
    });
}

async function nettoyer() {
  for (const nom of Object.values(EGLISES)) {
    await dansEglise(nom, async (c) => {
      const familles = `SELECT id FROM "Famille" WHERE nom = '${NOM}'`;
      await c.query(`DELETE FROM "CarteFamille" WHERE "familleId" IN (${familles})`);
      await c.query(`DELETE FROM "Enfant" WHERE "familleId" IN (${familles})`);
      await c.query(`DELETE FROM "Famille" WHERE nom = $1`, [NOM]);
    });
  }
}

test.beforeEach(async () => {
  await reinitialiserLimites();
  await nettoyer();
});
test.afterEach(nettoyer);

async function telecharger(page: Page, declencheur: () => Promise<void>) {
  const [telechargement] = await Promise.all([page.waitForEvent("download"), declencheur()]);
  const flux = await telechargement.createReadStream();
  const morceaux: Buffer[] = [];
  for await (const m of flux) morceaux.push(m as Buffer);
  return { nom: telechargement.suggestedFilename(), contenu: Buffer.concat(morceaux) };
}

test("les cinq formats sont présentés à la même échelle, et le PDF d'essai se télécharge", async ({
  page,
}, testInfo) => {
  const eglise = egliseDuProjet(testInfo);
  await seConnecter(page, email("admin", eglise));
  await attendreAccueil(page, EGLISES[eglise]);
  await page.goto("/parametres/impression");

  const apercus = page.locator("[data-testid^='apercu-']");
  await expect(apercus).toHaveCount(5);
  const tailles = await apercus.evaluateAll((elements) =>
    elements.map((e) => ({
      largeurMm: Number(e.getAttribute("data-largeur-mm")),
      hauteurMm: Number(e.getAttribute("data-hauteur-mm")),
      largeurPx: e.getBoundingClientRect().width,
      hauteurPx: e.getBoundingClientRect().height,
    })),
  );
  // Same scale for all: pixels per millimetre identical, true proportions.
  const echelle = tailles[0]!.largeurPx / tailles[0]!.largeurMm;
  for (const t of tailles) {
    expect(t.largeurPx / t.largeurMm).toBeCloseTo(echelle, 1);
    expect(t.hauteurPx / t.hauteurMm).toBeCloseTo(echelle, 1);
  }
  await page.getByRole("list", { name: "Aperçus des formats" }).screenshot({
    path: testInfo.outputPath("apercus-formats.png"),
  });

  const { nom, contenu } = await telecharger(page, () =>
    page.getByRole("link", { name: "Télécharger un PDF d'essai" }).click(),
  );
  expect(nom).toBe("carte-essai-90x54.pdf");
  expect(contenu.subarray(0, 5).toString()).toBe("%PDF-");
});

test("l'accueil imprime la carte, la réimprime, puis la remet à la famille", async ({
  page,
}, testInfo) => {
  const eglise = egliseDuProjet(testInfo);
  const familleId = await creerFamille(EGLISES[eglise]);
  await seConnecter(page, email("accueil", eglise));
  await attendreAccueil(page, EGLISES[eglise]);
  await page.goto(`/familles/${familleId}`);

  const premiere = await telecharger(page, () =>
    page.getByRole("button", { name: "Imprimer la carte" }).click(),
  );
  expect(premiere.contenu.subarray(0, 5).toString()).toBe("%PDF-");
  const liste = page.getByRole("list", { name: "Cartes de la famille" });
  await expect(liste.getByText(/· active$/)).toHaveCount(1);

  // A reprint stays pending: the card in circulation remains valid.
  await telecharger(page, () => page.getByRole("button", { name: "Imprimer la carte" }).click());
  await expect(liste.getByText(/en attente de remise$/)).toHaveCount(1);
  await expect(liste.getByText(/· active$/)).toHaveCount(1);

  await page.getByRole("button", { name: "Remettre la carte" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Carte remise : elle est active, l'ancienne carte est révoquée.",
  );
  await expect(liste.getByText(/· active$/)).toHaveCount(1);
  await expect(liste.getByText(/· révoquée$/)).toHaveCount(1);
});

test("RG-16 : l'administrateur passe en mode enfant et réémet les cartes, 3 cartes pour 3 enfants", async ({
  page,
}, testInfo) => {
  const eglise = egliseDuProjet(testInfo);
  const familleId = await creerFamille(EGLISES[eglise], ["Ayo", "Sèna", "Koffi"]);
  const remettreEnEtat = await instantaneCartes(EGLISES[eglise]);
  try {
    await seConnecter(page, email("admin", eglise));
    await attendreAccueil(page, EGLISES[eglise]);
    await page.goto("/parametres/cartes");
    await page.getByRole("radio", { name: /Une carte par enfant/ }).check();
    await page.getByRole("button", { name: "Changer le mode de carte" }).click();
    await expect(page.getByRole("status")).toHaveText("Mode de carte changé.");

    await expect(page.getByTestId("reemission-volume")).toContainText("famille(s) inscrite(s)");
    // A deadline out of the accepted range is refused by the server, nothing is issued.
    const refus = await page.evaluate(async () => {
      const r = await fetch("/api/impression/reemission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dernierJour: "2099-01-01" }),
      });
      return { statut: r.status, corps: await r.json() };
    });
    expect(refus).toEqual({
      statut: 409,
      corps: { ok: false, erreur: "Choisissez une date limite dans l'année qui vient." },
    });

    await page.getByRole("button", { name: "Réémettre les cartes" }).click();
    const { nom, contenu } = await telecharger(page, () =>
      page.getByRole("button", { name: "Confirmer la réémission" }).click(),
    );
    expect(nom).toBe("reemission-cartes.pdf");
    expect(contenu.subarray(0, 5).toString()).toBe("%PDF-");
    await expect(page.getByRole("status").filter({ hasText: "Cartes réémises" })).toHaveText(
      /^Cartes réémises : \d+ carte\(s\) à remettre aux familles\.$/,
    );
    await expect(page.getByRole("region", { name: "Dernières réémissions" })).toContainText(
      "mode « une carte par enfant »",
    );

    // The test family (no card before): one card per child, linked to the reissue.
    let cartes: { enfantId: string | null; activeLe: Date | null; reemissionId: string | null }[] =
      [];
    await dansEglise(EGLISES[eglise], async (c) => {
      cartes = (
        await c.query(
          `SELECT "enfantId", "activeLe", "reemissionId" FROM "CarteFamille" WHERE "familleId" = $1`,
          [familleId],
        )
      ).rows;
    });
    expect(cartes).toHaveLength(3);
    expect(new Set(cartes.map((c) => c.enfantId)).size).toBe(3);
    expect(cartes.every((c) => c.reemissionId !== null)).toBe(true);
  } finally {
    await remettreEnEtat();
  }
});

test("la vérification d'une carte refuse une carte remplacée, d'une autre église ou inconnue", async ({
  page,
}, testInfo) => {
  const eglise = egliseDuProjet(testInfo);
  const autre = eglise === "cotonou" ? "porto-novo" : "cotonou";
  const familleId = await creerFamille(EGLISES[eglise]);
  const familleAutre = await creerFamille(EGLISES[autre]);
  await dansEglise(EGLISES[eglise], (c, egliseId) =>
    c
      .query(
        `INSERT INTO "CarteFamille" (id, "egliseId", "familleId", "tokenHash", "activeLe", "revoqueeLe")
         VALUES ($1, $2, $3, $4, now(), now())`,
        [`${familleId}_c`, egliseId, familleId, empreinte(jeton("R"))],
      )
      .then(() => undefined),
  );
  await dansEglise(EGLISES[autre], (c, egliseId) =>
    c
      .query(
        `INSERT INTO "CarteFamille" (id, "egliseId", "familleId", "tokenHash", "activeLe")
         VALUES ($1, $2, $3, $4, now())`,
        [`${familleAutre}_c`, egliseId, familleAutre, empreinte(jeton("B"))],
      )
      .then(() => undefined),
  );

  await seConnecter(page, email("accueil", eglise));
  await attendreAccueil(page, EGLISES[eglise]);
  await page.goto("/cartes/verifier");
  const champ = page.getByLabel("Scannez la carte ou saisissez son code");
  const verifier = async (valeur: string, message: string) => {
    await champ.fill(valeur);
    await champ.press("Enter");
    await expect(page.getByRole("status")).toHaveText(message);
  };
  await verifier(
    jeton("R"),
    "Cette carte a été remplacée. Demandez la nouvelle carte au parent ou recherchez la famille.",
  );
  await verifier(jeton("B"), "Cette carte n'appartient pas à cette église.");
  await verifier(jeton("Z"), "Carte inconnue. Vérifiez la carte ou recherchez la famille.");
});

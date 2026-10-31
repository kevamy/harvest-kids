import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import {
  EGLISES,
  attendreAccueil,
  egliseDuProjet,
  email,
  reinitialiserLimites,
  seConnecter,
} from "./support/base";
import { expect, test, type EgliseIsolee } from "./support/eglise-isolee";

const empreinte = (jeton: string) => createHash("sha256").update(jeton, "utf8").digest("hex");
const jeton = (lettre: string) => `HKF1.${lettre.repeat(22)}`;

test.beforeEach(reinitialiserLimites);

async function telecharger(page: Page, declencheur: () => Promise<void>) {
  const [telechargement] = await Promise.all([page.waitForEvent("download"), declencheur()]);
  const flux = await telechargement.createReadStream();
  const morceaux: Buffer[] = [];
  for await (const m of flux) morceaux.push(m as Buffer);
  return { nom: telechargement.suggestedFilename(), contenu: Buffer.concat(morceaux) };
}

/** A card inserted directly (its clear token is known to the test). */
const insererCarte = (
  eglise: EgliseIsolee,
  familleId: string,
  lettre: string,
  etat: { revoquee?: boolean } = {},
) =>
  eglise.dansEglise((c) =>
    c.query(
      `INSERT INTO "CarteFamille" (id, "egliseId", "familleId", "tokenHash", "activeLe", "revoqueeLe")
       VALUES ($1, $2, $3, $4, now(), CASE WHEN $5 THEN now() END)`,
      [
        `${familleId}_carte_${lettre}`,
        eglise.id,
        familleId,
        empreinte(jeton(lettre)),
        !!etat.revoquee,
      ],
    ),
  );

// Read-only on the demonstration church: its real logo is shown in the previews.
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
  eglise,
}) => {
  const { familleId } = await eglise.creerFamille("Cartes", ["Ayo"]);
  await seConnecter(page, eglise.email("ACCUEIL"));
  await attendreAccueil(page, eglise.nom);
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
  eglise,
}) => {
  // A family without card (3 children) and a family whose card is in circulation.
  const { familleId, enfantIds } = await eglise.creerFamille("Trois", ["Ayo", "Sèna", "Koffi"]);
  const ancienne = await eglise.creerFamille("Ancienne", ["Codjo"]);
  await insererCarte(eglise, ancienne.familleId, "A");

  await seConnecter(page, eglise.email("ADMIN"));
  await attendreAccueil(page, eglise.nom);
  await page.goto("/parametres/cartes");
  await page.getByRole("radio", { name: /Une carte par enfant/ }).check();
  await page.getByRole("button", { name: "Changer le mode de carte" }).click();
  await expect(page.getByRole("status")).toHaveText("Mode de carte changé.");
  await expect(page.getByTestId("reemission-volume")).toHaveText(
    "2 famille(s) inscrite(s), 4 carte(s) à imprimer.",
  );

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

  // Last day of the old cards: in a week, in the church's time zone.
  const dernierJour = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Porto-Novo" }).format(
    new Date(Date.now() + 7 * 86_400_000),
  );
  await page.getByLabel(/Dernier jour de validité des anciennes cartes/).fill(dernierJour);
  await page.getByRole("button", { name: "Réémettre les cartes" }).click();
  const { nom, contenu } = await telecharger(page, () =>
    page.getByRole("button", { name: "Confirmer la réémission" }).click(),
  );
  expect(nom).toBe("reemission-cartes.pdf");
  expect(contenu.subarray(0, 5).toString()).toBe("%PDF-");
  await expect(page.getByRole("status").filter({ hasText: "Cartes réémises" })).toHaveText(
    "Cartes réémises : 4 carte(s) à remettre aux familles.",
  );
  await expect(page.getByRole("region", { name: "Dernières réémissions" })).toContainText(
    /mode « une carte par enfant » · 4 carte\(s\) · anciennes cartes valides jusqu'au \d+/,
  );

  const cartes = await eglise.dansEglise(
    async (c) =>
      (
        await c.query<{
          familleId: string;
          enfantId: string | null;
          active: boolean;
          revoquee: boolean;
          reemission: boolean;
        }>(
          `SELECT "familleId", "enfantId", "activeLe" IS NOT NULL AS active,
                  "revoqueeLe" IS NOT NULL AS revoquee, "reemissionId" IS NOT NULL AS reemission
           FROM "CarteFamille" ORDER BY "enfantId" NULLS FIRST`,
        )
      ).rows,
  );
  // No card before: one active card per child at once.
  expect(cartes.filter((c) => c.familleId === familleId)).toEqual(
    [...enfantIds].sort().map((enfantId) => ({
      familleId,
      enfantId,
      active: true,
      revoquee: false,
      reemission: true,
    })),
  );
  // A card in circulation: it stays valid, the new child card waits to be handed over.
  expect(cartes.filter((c) => c.familleId === ancienne.familleId)).toEqual([
    {
      familleId: ancienne.familleId,
      enfantId: null,
      active: true,
      revoquee: false,
      reemission: false,
    },
    {
      familleId: ancienne.familleId,
      enfantId: ancienne.enfantIds[0],
      active: false,
      revoquee: false,
      reemission: true,
    },
  ]);
});

test("la vérification d'une carte refuse une carte remplacée, d'une autre église ou inconnue", async ({
  page,
  eglise,
  autreEglise,
}) => {
  const { familleId } = await eglise.creerFamille("Verification", ["Ayo"]);
  await insererCarte(eglise, familleId, "R", { revoquee: true });
  const autre = await autreEglise.creerFamille("Ailleurs", ["Sèna"]);
  await insererCarte(autreEglise, autre.familleId, "B");

  await seConnecter(page, eglise.email("ACCUEIL"));
  await attendreAccueil(page, eglise.nom);
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

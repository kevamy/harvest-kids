import { createHash } from "node:crypto";
import { attendreAccueil, reinitialiserLimites, seConnecter } from "./support/base";
import { expect, test, type EgliseIsolee } from "./support/eglise-isolee";

const empreinte = (jeton: string) => createHash("sha256").update(jeton, "utf8").digest("hex");
const jeton = (lettre: string) => `HKB1.${lettre.repeat(22)}`;

test.beforeEach(reinitialiserLimites);

/** The monitor of a test church (support/eglise-isolee.ts). */
const membreMoniteur = (eglise: EgliseIsolee) => `${eglise.id}_moniteur_membre`;

/** A badge inserted directly (its clear token is known to the test). */
const insererBadge = (eglise: EgliseIsolee, lettre: string, revoque = false) =>
  eglise.dansEglise((c) =>
    c.query(
      `INSERT INTO "BadgeMoniteur" (id, "egliseId", "membreId", "tokenHash", "revoqueLe")
       VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() END)`,
      [
        `${eglise.id}_badge_${lettre}`,
        eglise.id,
        membreMoniteur(eglise),
        empreinte(jeton(lettre)),
        revoque,
      ],
    ),
  );

test("l'administrateur imprime le badge d'un moniteur", async ({ page, eglise }) => {
  await seConnecter(page, eglise.email("ADMIN"));
  await attendreAccueil(page, eglise.nom);
  await page.getByRole("link", { name: "Paramètres" }).click();
  await page.getByRole("link", { name: /^Badges moniteurs/ }).click();
  await expect(page).toHaveURL(/\/parametres\/badges$/);

  const liste = page.getByRole("list", { name: "Moniteurs" });
  await expect(liste.getByRole("listitem")).toHaveCount(1);
  await expect(liste).toContainText("Moniteur test");
  await expect(liste).toContainText("Aucun badge");

  const [telechargement] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Imprimer le badge de Moniteur test" }).click(),
  ]);
  expect(telechargement.suggestedFilename()).toBe("badges-moniteurs.pdf");
  const morceaux: Buffer[] = [];
  for await (const m of await telechargement.createReadStream()) morceaux.push(m as Buffer);
  expect(Buffer.concat(morceaux).subarray(0, 5).toString()).toBe("%PDF-");
  await expect(page.getByRole("status")).toHaveText(
    "Badge imprimé. Remettez-le au moniteur : l'ancien badge est désormais refusé.",
  );
  await expect(liste).toContainText(/Badge actif depuis le \d+/);
});

test("le scan d'un badge : valide, remplacé ou d'une autre église", async ({
  page,
  eglise,
  autreEglise,
}) => {
  await insererBadge(eglise, "R", true);
  await insererBadge(eglise, "V");
  await insererBadge(autreEglise, "B");

  await seConnecter(page, eglise.email("ACCUEIL"));
  await attendreAccueil(page, eglise.nom);
  await page.goto("/cartes/verifier");
  const champ = page.getByLabel("Scannez la carte ou saisissez son code");
  const verifier = async (lettre: string, message: string) => {
    await champ.fill(jeton(lettre));
    await champ.press("Enter");
    await expect(page.getByRole("status")).toHaveText(message);
  };
  await verifier("V", "Badge moniteur valide.");
  await expect(page.getByText("Moniteur : Moniteur test")).toBeVisible();
  await verifier(
    "R",
    "Ce badge a été remplacé. Utilisez votre nouveau badge ou sélectionnez-vous dans la liste.",
  );
  await verifier("B", "Cette carte n'appartient pas à cette église.");
});

test("le responsable n'a pas accès aux badges", async ({ page, eglise }) => {
  await seConnecter(page, eglise.email("RESPONSABLE"));
  await attendreAccueil(page, eglise.nom);
  await page.goto("/parametres");
  await expect(page.getByRole("link", { name: /^Badges moniteurs/ })).toHaveCount(0);
  expect((await page.goto("/parametres/badges"))?.status()).toBe(404);
});

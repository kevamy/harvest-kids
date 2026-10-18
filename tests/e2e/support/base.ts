import { expect, type Page, type TestInfo } from "@playwright/test";
import pg from "pg";

try {
  process.loadEnvFile();
} catch {
  // CI: variables come from the environment
}

export const MOT_DE_PASSE = process.env.SEED_MOT_DE_PASSE || "Demo-HarvestKids-2026";
export const PIN = "482913";
const DOMAINE = "demo.harvest-kids.test";

export const EGLISES = {
  cotonou: "Église de démonstration Cotonou",
  "porto-novo": "Église de démonstration Porto-Novo",
} as const;

/** Each viewport uses its own church's accounts, so parallel projects never collide. */
export function egliseDuProjet(testInfo: TestInfo): keyof typeof EGLISES {
  return testInfo.project.name.includes("portrait") ? "porto-novo" : "cotonou";
}

export function email(libelle: string, eglise: keyof typeof EGLISES) {
  return `${libelle}.${eglise}@${DOMAINE}`;
}

export const EMAIL_DEUX_EGLISES = `moniteur.deux-eglises@${DOMAINE}`;

/** Owner connection to the development database, for test set-up only. */
export async function avecBase<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error("DATABASE_MIGRATION_URL est obligatoire pour les tests e2e.");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Sign-in attempts are throttled; tests start from a clean slate. */
export async function reinitialiserLimites() {
  await avecBase((c) => c.query(`DELETE FROM "AuthRateLimit" WHERE key LIKE 'connexion:%'`));
}

export async function seConnecter(page: Page, identifiant: string, motDePasse = MOT_DE_PASSE) {
  await page.goto("/connexion");
  await page.getByLabel("E-mail ou téléphone").fill(identifiant);
  await page.getByLabel("Mot de passe").fill(motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

export async function attendreAccueil(page: Page, eglise: string) {
  // Sign-in hashes the password (scrypt): allow for parallel workers.
  await expect(page).toHaveURL(/\/accueil$/, { timeout: 20_000 });
  await expect(page.getByTestId("eglise-active")).toHaveText(eglise);
}

/** Moves the latest session's last activity into the past (simulated idle time). */
export async function vieillirDerniereActivite(adresse: string, minutes: number) {
  await avecBase((c) =>
    c.query(
      `UPDATE "AuthSession" SET "derniereActivite" = now() - make_interval(mins => $2)
       WHERE id = (SELECT s.id FROM "AuthSession" s JOIN "User" u ON u.id = s."userId"
                   WHERE u.email = $1 ORDER BY s."createdAt" DESC LIMIT 1)`,
      [adresse, minutes],
    ),
  );
}

export async function derniereActivite(adresse: string): Promise<Date> {
  return avecBase(async (c) => {
    const { rows } = await c.query<{ d: Date }>(
      `SELECT s."derniereActivite" AS d FROM "AuthSession" s JOIN "User" u ON u.id = s."userId"
       WHERE u.email = $1 ORDER BY s."createdAt" DESC LIMIT 1`,
      [adresse],
    );
    return rows[0]!.d;
  });
}

/**
 * Daily task (ADR 0010): /api/taches/quotidiennes is protected by CRON_SECRET, and the
 * task purges expired drafts, revokes cards past a reissue deadline and deletes replaced
 * files 24 hours later, church by church, idempotently, with audit entries.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { cleFichier } from "@/lib/fichiers";
import { creerStockageLocal } from "@/lib/storage/local";
import { clientEglise, type ClientEglise } from "@/lib/tenant";
import { emettreCarte } from "@/server/cartes/cycle";
import { creerBrouillon } from "@/server/familles";
import { programmerSuppression } from "@/server/fichiers-differes";
import { creerClientPlateforme } from "@/server/plateforme/db";
import { executerTachesQuotidiennes } from "@/server/plateforme/taches";
import { type Client, type Jeu, connecter, creerEglise, enEglise, viderBase } from "./support/db";
import { urlsDeTest } from "./support/urls";

let base: PrismaClient;
let proprietaire: Client;
let a: Jeu;
let b: Jeu;
let dbA: ClientEglise;
let dossier: string;

const AUTEUR = { userId: "user_test", appareil: null };
const JOUR = 24 * 60 * 60 * 1000;
const dansJours = (jours: number) => new Date(Date.now() + jours * JOUR);

beforeAll(async () => {
  base = creerClientPlateforme(urlsDeTest().app);
  proprietaire = await connecter("proprietaire");
  dossier = await mkdtemp(join(tmpdir(), "hk-taches-"));
});

afterAll(async () => {
  await base?.$disconnect();
  await proprietaire?.end();
  await rm(dossier, { recursive: true, force: true });
});

beforeEach(async () => {
  await viderBase(proprietaire);
  a = await creerEglise(proprietaire, "a");
  b = await creerEglise(proprietaire, "b");
  dbA = clientEglise(base, a.egliseId);
});

const audit = (jeu: Jeu) =>
  enEglise(proprietaire, jeu.egliseId, async () => {
    const { rows } = await proprietaire.query(
      `SELECT action, "userId", appareil FROM "AuditLog" ORDER BY "createdAt", id`,
    );
    return rows;
  });

const brouillon = (db: ClientEglise, nom: string) =>
  db.$tx((tx) =>
    creerBrouillon(tx, AUTEUR, "229", {
      nom,
      tuteurs: [
        { prenom: "T", nom, lien: "Mère", telephone: "+229 01 02 03 04 05", principal: true },
      ],
      enfants: [{ prenom: "E", nom, dateNaissance: new Date("2020-05-05") }],
    }),
  );

/** Moves a draft's creation date into the past (owner role, inside its church). */
const vieillir = (jeu: Jeu, familleId: string, jours: number) =>
  enEglise(proprietaire, jeu.egliseId, () =>
    proprietaire.query(
      `UPDATE "Famille" SET "createdAt" = now() - $2::int * interval '1 day' WHERE id = $1`,
      [familleId, jours],
    ),
  );

describe("purge des brouillons", () => {
  it("supprime les brouillons expirés, garde les récents et les familles finalisées, avec audit", async () => {
    const vieux = await brouillon(dbA, "Vieux");
    const recent = await brouillon(dbA, "Recent");
    await vieillir(a, vieux.id, 91);
    await vieillir(a, recent.id, 89);
    await vieillir(a, a.familleId, 400); // finalised: never purged

    const stockage = creerStockageLocal(dossier);
    const bilan = await executerTachesQuotidiennes(base, stockage);
    expect(bilan).toMatchObject({ brouillonsPurges: 1, erreurs: 0 });

    const familles = (await dbA.famille.findMany({ select: { id: true } })).map((f) => f.id).sort();
    expect(familles).toEqual([a.familleId, recent.id].sort());
    const entrees = await audit(a);
    expect(entrees.at(-1)).toEqual({
      action: "famille.brouillon_purge",
      userId: null,
      appareil: "tache-quotidienne",
    });

    // Idempotent: a second run purges nothing more.
    expect((await executerTachesQuotidiennes(base, stockage)).brouillonsPurges).toBe(0);
  });

  it("suit le délai de chaque église", async () => {
    const vieux = await brouillon(dbA, "Vieux");
    await vieillir(a, vieux.id, 20);
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "Parametre" ("egliseId", cle, valeur) VALUES ($1, 'familles.delaiPurgeBrouillonsJours', '14')`,
        [a.egliseId],
      ),
    );
    const dbB = clientEglise(base, b.egliseId);
    const vieuxB = await brouillon(dbB, "VieuxB");
    await vieillir(b, vieuxB.id, 20);

    expect(
      (await executerTachesQuotidiennes(base, creerStockageLocal(dossier))).brouillonsPurges,
    ).toBe(1);
    expect(await dbA.famille.findUnique({ where: { id: vieux.id } })).toBeNull();
    expect(await dbB.famille.findUnique({ where: { id: vieuxB.id } })).not.toBeNull();
  });
});

describe("révocation à date limite (RG-16)", () => {
  it("révoque les anciennes cartes après la date limite, pas avant, avec audit", async () => {
    const ancienne = await dbA.$tx((tx) => emettreCarte(tx, AUTEUR, { familleId: a.familleId }));
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "ReemissionCartes" (id, "egliseId", mode, "dateLimite", "creePar") VALUES ('r', $1, 'ENFANT', $2, 'u')`,
        [a.egliseId, dansJours(3)],
      ),
    );
    await dbA.$tx((tx) =>
      emettreCarte(
        tx,
        AUTEUR,
        { familleId: a.familleId, enfantId: a.enfantId },
        { reemissionId: "r" },
      ),
    );
    const stockage = creerStockageLocal(dossier);

    expect((await executerTachesQuotidiennes(base, stockage)).cartesRevoquees).toBe(0);
    const bilan = await executerTachesQuotidiennes(base, stockage, dansJours(4));
    expect(bilan.cartesRevoquees).toBe(1);
    const carte = await dbA.carteFamille.findUnique({ where: { id: ancienne.carteId } });
    expect(carte?.revoqueeLe).not.toBeNull();
    expect((await audit(a)).at(-1)).toMatchObject({ action: "carte.revoquee", userId: null });

    expect((await executerTachesQuotidiennes(base, stockage, dansJours(5))).cartesRevoquees).toBe(
      0,
    );
  });
});

describe("suppression différée des fichiers remplacés", () => {
  it("garde le fichier 24 h, puis le supprime ; une clé d'une autre église n'est jamais supprimée", async () => {
    const stockage = creerStockageLocal(dossier);
    const cle = cleFichier(a.egliseId, "photos", "ancienne.webp");
    const cleB = cleFichier(b.egliseId, "photos", "photo-b.webp");
    await stockage.put(cle, new Uint8Array([1]), "image/webp");
    await stockage.put(cleB, new Uint8Array([2]), "image/webp");
    await dbA.$tx((tx) => programmerSuppression(tx, cle));
    // A forged row naming another church's file, inserted in A by the owner.
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "FichierASupprimer" (id, "egliseId", cle, "apresLe") VALUES ('forge', $1, $2, now())`,
        [a.egliseId, cleB],
      ),
    );

    expect((await executerTachesQuotidiennes(base, stockage)).fichiersSupprimes).toBe(1); // the forged row only
    expect(await stockage.get(cle)).not.toBeNull();
    expect(await stockage.get(cleB)).not.toBeNull();

    expect(
      (await executerTachesQuotidiennes(base, stockage, dansJours(1.01))).fichiersSupprimes,
    ).toBe(1);
    expect(await stockage.get(cle)).toBeNull();
    expect(await dbA.fichierASupprimer.count()).toBe(0);
    expect((await executerTachesQuotidiennes(base, stockage, dansJours(2))).fichiersSupprimes).toBe(
      0,
    );
  });
});

describe("route /api/taches/quotidiennes", () => {
  const SECRET = "secret-de-tache-quotidienne-".padEnd(40, "x");

  async function appeler(autorisation: string | null, secret: string | null) {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", urlsDeTest().app);
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-".padEnd(40, "x"));
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("STORAGE_DRIVER", "local");
    vi.stubEnv("UPLOADS_DIR", dossier);
    vi.stubEnv("CRON_SECRET", secret ?? "");
    const { prismaPlateforme } = await import("@/server/plateforme/db");
    const { GET } = await import("@/app/api/taches/quotidiennes/route");
    try {
      const entetes: Record<string, string> = autorisation ? { authorization: autorisation } : {};
      const reponse = await GET(
        new Request("http://localhost/api/taches/quotidiennes", { headers: entetes }),
      );
      return { statut: reponse.status, corps: await reponse.json() };
    } finally {
      await prismaPlateforme().$disconnect();
      delete (globalThis as { prismaPlateforme?: unknown }).prismaPlateforme;
    }
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuse un appel sans secret, avec un mauvais secret, ou si CRON_SECRET est absent", async () => {
    expect(await appeler(null, SECRET)).toEqual({ statut: 401, corps: { ok: false } });
    expect(await appeler("Bearer mauvais", SECRET)).toEqual({ statut: 401, corps: { ok: false } });
    expect(await appeler(SECRET, SECRET)).toEqual({ statut: 401, corps: { ok: false } });
    expect(await appeler(`Bearer ${SECRET}`, null)).toEqual({ statut: 401, corps: { ok: false } });
  });

  it("exécute la tâche avec le bon secret et ne renvoie que des compteurs", async () => {
    expect(await appeler(`Bearer ${SECRET}`, SECRET)).toEqual({
      statut: 200,
      corps: {
        ok: true,
        eglises: 2,
        brouillonsPurges: 0,
        cartesRevoquees: 0,
        fichiersSupprimes: 0,
        erreurs: 0,
      },
    });
  });
});

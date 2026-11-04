/**
 * Bulk reissue (RG-16, cahier §7.10): new pending cards for every finalised family in
 * the current mode, one ReemissionCartes row, a PDF rendered before the transaction.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { clientEglise, type ClientEglise } from "@/lib/tenant";
import {
  activerAuPremierScan,
  activerCarte,
  emettreCarte,
  revoquerCartesPerimees,
} from "@/server/cartes/cycle";
import { resoudreJeton } from "@/server/cartes/resolution";
import { ImpressionRefusee } from "@/server/impression/cartes";
import type { ContenuCarte, OptionsImpression } from "@/server/impression/pdf-carte";
import { dateLimiteDepuisJour, reemettreCartes } from "@/server/impression/reemission";

// The real renderer, recording what it printed; a test may ask for a rendering failure.
const rendu = vi.hoisted(() => ({
  echoue: false,
  cartes: [] as ContenuCarte[],
  options: null as OptionsImpression | null,
}));
vi.mock("@/server/impression/pdf-carte", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/server/impression/pdf-carte")>();
  return {
    ...reel,
    genererPdfCartes: (...args: Parameters<typeof reel.genererPdfCartes>) => {
      if (rendu.echoue) return Promise.reject(new Error("rendu impossible"));
      rendu.cartes = args[0] as ContenuCarte[]; // a reissue prints cards only

      rendu.options = args[2];
      return reel.genererPdfCartes(...args);
    },
  };
});
import { verificationMoniteur } from "@/server/plateforme/badges";
import { creerClientPlateforme } from "@/server/plateforme/db";
import {
  type Client,
  type Jeu,
  connecter,
  contexteVerifie,
  creerEglise,
  enEglise,
  viderBase,
} from "./support/db";
import { urlsDeTest } from "./support/urls";

let base: PrismaClient;
let proprietaire: Client;
let a: Jeu;
let b: Jeu;
let dbA: ClientEglise;

const AUTEUR = { userId: "user_test", appareil: null };
const EGLISE = { nom: "Église A", logo: null, telephoneAccueil: "+2290197451233" };
const ENFANT_2 = "enfant_a_2";

beforeAll(async () => {
  base = creerClientPlateforme(urlsDeTest().app);
  proprietaire = await connecter("proprietaire");
});

afterAll(async () => {
  await base?.$disconnect();
  await proprietaire?.end();
});

beforeEach(async () => {
  await viderBase(proprietaire);
  a = await creerEglise(proprietaire, "a");
  b = await creerEglise(proprietaire, "b");
  await enEglise(proprietaire, a.egliseId, async () => {
    await proprietaire.query(
      `INSERT INTO "Enfant" (id, "egliseId", matricule, "familleId", prenom, nom, "dateNaissance", "updatedAt")
       VALUES ($1, $2, 'HK-0002', $3, 'Cadet', 'Nom', '2022-01-01', now())`,
      [ENFANT_2, a.egliseId, a.familleId],
    );
    // A draft family (CSV import): neither matricule nor card.
    await proprietaire.query(
      `INSERT INTO "Famille" (id, "egliseId", nom, "updatedAt") VALUES ('brouillon_a', $1, 'Brouillon', now())`,
      [a.egliseId],
    );
    await proprietaire.query(
      `INSERT INTO "Enfant" (id, "egliseId", "familleId", prenom, nom, "dateNaissance", "updatedAt")
       VALUES ('enfant_brouillon', $1, 'brouillon_a', 'Sans', 'Matricule', '2021-01-01', now())`,
      [a.egliseId],
    );
  });
  dbA = clientEglise(base, a.egliseId);
  rendu.cartes = [];
  rendu.options = null;
});

const modeA = (mode: "FAMILLE" | "ENFANT") =>
  enEglise(proprietaire, a.egliseId, () =>
    proprietaire.query(
      `INSERT INTO "Parametre" ("egliseId", cle, valeur) VALUES ($1, 'cartes.mode', $2)
       ON CONFLICT ("egliseId", cle) DO UPDATE SET valeur = EXCLUDED.valeur`,
      [a.egliseId, JSON.stringify(mode)],
    ),
  );

const reemettre = (dateLimite: Date | null = null) =>
  reemettreCartes(dbA, AUTEUR, EGLISE, { dateLimite });

const cartesA = () =>
  dbA.carteFamille.findMany({
    orderBy: { emiseLe: "asc" },
    select: {
      id: true,
      familleId: true,
      enfantId: true,
      activeLe: true,
      revoqueeLe: true,
      reemissionId: true,
    },
  });

const premiereCarte = () => dbA.$tx((tx) => emettreCarte(tx, AUTEUR, { familleId: a.familleId }));

/** Clear token printed for a coverage, read from what the renderer received. */
const jetonImprime = (prenom: string) =>
  rendu.cartes.find((c) => c.enfants.length === 1 && c.enfants[0]!.prenom === prenom)!.jeton;

const resoudre = (jeton: string) =>
  resoudreJeton(dbA, jeton, verificationMoniteur(base, contexteVerifie(a)));

/** Invariant: for each child, at most one active card covers it (family or child card). */
async function expectUneCarteActiveAuPlus() {
  const { rows } = await enEglise(proprietaire, a.egliseId, () =>
    proprietaire.query<{ enfant: string; n: number }>(`
      SELECT e.id AS enfant, count(c.id)::int AS n
      FROM "Enfant" e
      LEFT JOIN "CarteFamille" c ON c."familleId" = e."familleId"
        AND c."revoqueeLe" IS NULL AND c."activeLe" IS NOT NULL
        AND (c."enfantId" IS NULL OR c."enfantId" = e.id)
      GROUP BY e.id`),
  );
  for (const { enfant, n } of rows) expect(n, enfant).toBeLessThanOrEqual(1);
}

describe("réémission groupée", () => {
  it("passage famille → enfant : une carte en attente par enfant, l'ancienne carte reste valide", async () => {
    const ancienne = await premiereCarte();
    await modeA("ENFANT");
    const resultat = await reemettre();
    expect(resultat.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(resultat).toMatchObject({ familles: 1, cartes: 2 });

    const cartes = await cartesA();
    const nouvelles = cartes.filter((c) => c.reemissionId === resultat.reemissionId);
    expect(new Set(nouvelles.map((c) => c.enfantId))).toEqual(new Set([a.enfantId, ENFANT_2]));
    expect(nouvelles.every((c) => c.activeLe === null && c.revoqueeLe === null)).toBe(true);
    // The draft family gets nothing; the old family card stays valid.
    expect(cartes.some((c) => c.familleId === "brouillon_a")).toBe(false);
    expect(await resoudre(ancienne.jeton)).toMatchObject({ statut: "active" });

    const reemission = await dbA.reemissionCartes.findUniqueOrThrow({
      where: { id: resultat.reemissionId },
      select: { mode: true, dateLimite: true, creePar: true },
    });
    expect(reemission).toEqual({ mode: "ENFANT", dateLimite: null, creePar: "user_test" });
    await expectUneCarteActiveAuPlus();
  });

  it("l'audit de la réémission ne contient que des comptes, aucune donnée personnelle", async () => {
    const { reemissionId } = await reemettre();
    const audit = await dbA.auditLog.findFirstOrThrow({
      where: { action: "reemission.creee", entiteId: reemissionId },
      select: { apres: true },
    });
    expect(audit.apres).toEqual({
      mode: "FAMILLE",
      format: "90x54",
      dateLimite: null,
      familles: 1,
      cartes: 1,
    });
  });

  it("premier scan d'une carte enfant, puis retour au mode famille : une seule carte active par enfant", async () => {
    const ancienne = await premiereCarte();
    await modeA("ENFANT");
    await reemettre();
    const jetonAine = jetonImprime("Prénom");

    // First check-in scan of the eldest's card: active, the family card is revoked.
    await dbA.$tx((tx) =>
      activerAuPremierScan(tx, AUTEUR, jetonAine, verificationMoniteur(base, contexteVerifie(a))),
    );
    expect(await resoudre(jetonAine)).toMatchObject({ statut: "active" });
    expect(await resoudre(ancienne.jeton)).toEqual({ statut: "revoquee" });
    await expectUneCarteActiveAuPlus();

    // Back to one card per family: the younger child's pending card is obsolete.
    await modeA("FAMILLE");
    const { reemissionId } = await reemettre();
    const cartes = await cartesA();
    const enfant2 = cartes.find((c) => c.enfantId === ENFANT_2)!;
    expect(enfant2.revoqueeLe).not.toBeNull();
    const famille = cartes.find((c) => c.reemissionId === reemissionId)!;
    expect(famille).toMatchObject({ enfantId: null, activeLe: null, revoqueeLe: null });

    await dbA.$tx((tx) => activerCarte(tx, AUTEUR, famille.id));
    expect(await resoudre(jetonAine)).toEqual({ statut: "revoquee" });
    await expectUneCarteActiveAuPlus();
  });

  it("dans le même mode (nouveau format) : carte famille en attente, au format des réglages", async () => {
    await premiereCarte();
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "Parametre" ("egliseId", cle, valeur)
         VALUES ($1, 'impression', '{"format":"70x100","rectoVerso":true}')`,
        [a.egliseId],
      ),
    );
    const { reemissionId } = await reemettre();
    expect(rendu.options).toMatchObject({ rectoVerso: true, sortie: "planche" });
    expect(rendu.options!.format.id).toBe("70x100");
    const cartes = await cartesA();
    expect(cartes.map((c) => [c.reemissionId, c.activeLe !== null, c.revoqueeLe !== null])).toEqual(
      [
        [null, true, false],
        [reemissionId, false, false],
      ],
    );
  });

  it("une famille sans carte active reçoit directement une carte active", async () => {
    const { cartes } = await reemettre();
    expect(cartes).toBe(1);
    expect((await cartesA())[0]!.activeLe).not.toBeNull();
  });

  it("date limite : l'ancienne carte est refusée ensuite, puis révoquée par la tâche quotidienne", async () => {
    const ancienne = await premiereCarte();
    const dateLimite = new Date(Date.now() + 86_400_000);
    await reemettre(dateLimite);
    expect(await resoudre(ancienne.jeton)).toMatchObject({ statut: "active" });

    // Once the deadline has passed (read at scan time, without writing).
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `UPDATE "ReemissionCartes" SET "dateLimite" = now() - interval '1 minute'`,
      ),
    );
    expect(await resoudre(ancienne.jeton)).toEqual({ statut: "perimee" });
    expect(await revoquerCartesPerimees(dbA)).toBe(1);
    expect(await resoudre(ancienne.jeton)).toEqual({ statut: "revoquee" });
    await expectUneCarteActiveAuPlus();
  });

  it("un rendu PDF en échec ne crée ni réémission ni carte", async () => {
    rendu.echoue = true;
    try {
      await expect(reemettre()).rejects.toThrow("rendu impossible");
    } finally {
      rendu.echoue = false;
    }
    expect(await cartesA()).toEqual([]);
    expect(await dbA.reemissionCartes.count()).toBe(0);
  });

  it("refuse une réémission sans famille inscrite", async () => {
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(`UPDATE "Famille" SET "finaliseeLe" = NULL`),
    );
    await expect(reemettre()).rejects.toThrow(ImpressionRefusee);
    expect(await dbA.reemissionCartes.count()).toBe(0);
  });

  it("isolation A/B : seules les familles de A sont réémises, rien n'est créé dans B", async () => {
    await reemettre();
    expect(rendu.cartes.map((c) => c.famille)).toEqual(["Famille a"]);
    // Filtered on B: the owner role also reads every church's cards (rg14_lecture_proprietaire).
    const compter = async (table: string) =>
      (
        await proprietaire.query(
          `SELECT count(*)::int AS n FROM "${table}" WHERE "egliseId" = $1`,
          [b.egliseId],
        )
      ).rows[0].n;
    const dansB = await enEglise(proprietaire, b.egliseId, async () => ({
      cartes: await compter("CarteFamille"),
      reemissions: await compter("ReemissionCartes"),
    }));
    expect(dansB).toEqual({ cartes: 0, reemissions: 0 });
  });
});

describe("date limite saisie (fuseau de l'église)", () => {
  const MAINTENANT = new Date("2026-10-31T10:00:00Z");

  it("le dernier jour de validité finit à minuit, heure de l'église", () => {
    // Porto-Novo is UTC+1 all year: local midnight on 1 December is 23:00 UTC on 30 November.
    // Paris is UTC+1 in winter and UTC+2 in summer.
    expect(dateLimiteDepuisJour("2026-11-30", "Africa/Porto-Novo", MAINTENANT).toISOString()).toBe(
      "2026-11-30T23:00:00.000Z",
    );
    expect(dateLimiteDepuisJour("2026-11-30", "Europe/Paris", MAINTENANT).toISOString()).toBe(
      "2026-11-30T23:00:00.000Z",
    );
    expect(dateLimiteDepuisJour("2027-07-01", "Europe/Paris", MAINTENANT).toISOString()).toBe(
      "2027-07-01T22:00:00.000Z",
    );
  });

  it("refuse aujourd'hui, une date passée, au-delà d'un an ou invalide", () => {
    for (const jour of ["2026-10-31", "2026-10-01", "2027-11-01", "2026-02-30", "demain"]) {
      expect(() => dateLimiteDepuisJour(jour, "Africa/Porto-Novo", MAINTENANT), jour).toThrow(
        ImpressionRefusee,
      );
    }
    expect(() => dateLimiteDepuisJour("2026-11-01", "Africa/Porto-Novo", MAINTENANT)).not.toThrow();
  });
});

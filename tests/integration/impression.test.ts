/**
 * Printing cards (cahier §7.10, RG-16, ADR 0008, decision 5 of the lot 1 plan): tokens
 * first, PDF in memory, then one transaction. A rendering failure creates no card.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { clientEglise, type ClientEglise } from "@/lib/tenant";
import { ImpressionRefusee, imprimerCartesFamille } from "@/server/impression/cartes";

// The real renderer, except when a test asks for a rendering failure.
const rendu = vi.hoisted(() => ({ echoue: false, eglise: null as unknown }));
vi.mock("@/server/impression/pdf-carte", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/server/impression/pdf-carte")>();
  return {
    ...reel,
    genererPdfCartes: (...args: Parameters<typeof reel.genererPdfCartes>) => {
      rendu.eglise = args[1];
      return rendu.echoue
        ? Promise.reject(new Error("rendu impossible"))
        : reel.genererPdfCartes(...args);
    },
  };
});
import { creerClientPlateforme } from "@/server/plateforme/db";
import { type Client, type Jeu, connecter, creerEglise, enEglise, viderBase } from "./support/db";
import { urlsDeTest } from "./support/urls";

let base: PrismaClient;
let proprietaire: Client;
let a: Jeu;
let b: Jeu;
let dbA: ClientEglise;

const AUTEUR = { userId: "user_test", appareil: null };
const EGLISE = { nom: "Église A", logo: null, telephoneAccueil: "+2290197451233" };

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
    for (const [i, prenom] of ["Sèna", "Koffi"].entries()) {
      await proprietaire.query(
        `INSERT INTO "Enfant" (id, "egliseId", matricule, "familleId", prenom, nom, "dateNaissance", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'Nom', '2021-01-0${i + 1}', now())`,
        [`enfant_a_${i + 2}`, a.egliseId, `HK-000${i + 2}`, a.familleId, prenom],
      );
    }
  });
  dbA = clientEglise(base, a.egliseId);
});

const cartesA = () =>
  dbA.carteFamille.findMany({
    orderBy: { emiseLe: "asc" },
    select: { id: true, enfantId: true, activeLe: true, revoqueeLe: true },
  });

const imprimer = (choix = {}) => imprimerCartesFamille(dbA, AUTEUR, a.familleId, EGLISE, choix);

describe("impression des cartes d'une famille", () => {
  it("la première carte est active ; une réimpression reste en attente", async () => {
    const premiere = await imprimer();
    expect(premiere.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(premiere.nomFichier).toBe("cartes-Famille-a.pdf");
    expect(premiere.cartes).toEqual([{ carteId: expect.any(String), active: true }]);

    const seconde = await imprimer({ format: "70x100" });
    expect(seconde.cartes).toEqual([{ carteId: expect.any(String), active: false }]);
    const cartes = await cartesA();
    expect(cartes.map((c) => [c.activeLe !== null, c.revoqueeLe !== null])).toEqual([
      [true, false],
      [false, false],
    ]);
  });

  it("carte perdue : la carte en circulation est révoquée, la nouvelle est active", async () => {
    await imprimer();
    const perdue = await imprimer({ perdue: true });
    expect(perdue.cartes).toEqual([{ carteId: expect.any(String), active: true }]);
    const cartes = await cartesA();
    expect(cartes[0]!.revoqueeLe).not.toBeNull();
    expect(cartes[1]!.activeLe).not.toBeNull();
  });

  it("RG-16 : en mode « une carte par enfant », une famille de 3 enfants reçoit 3 cartes", async () => {
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "Parametre" ("egliseId", cle, valeur) VALUES ($1, 'cartes.mode', '"ENFANT"')`,
        [a.egliseId],
      ),
    );
    const { cartes } = await imprimer();
    expect(cartes).toHaveLength(3);
    const enBase = await cartesA();
    expect(new Set(enBase.map((c) => c.enfantId))).toEqual(
      new Set([a.enfantId, "enfant_a_2", "enfant_a_3"]),
    );
  });

  it("le PDF reprend les textes de carte de l'église", async () => {
    const textes = {
      afficherTelephone: false,
      consigneCourte: "Consigne de l'église A.",
      titreVerso: "Titre A",
      consignesVerso: ["Consigne A."],
    };
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "Parametre" ("egliseId", cle, valeur) VALUES ($1, 'cartes.textes', $2)`,
        [a.egliseId, JSON.stringify(textes)],
      ),
    );
    await imprimer();
    expect(rendu.eglise).toEqual({ ...EGLISE, textes });
  });

  it("un rendu PDF en échec ne crée aucune carte", async () => {
    rendu.echoue = true;
    try {
      await expect(imprimer()).rejects.toThrow("rendu impossible");
    } finally {
      rendu.echoue = false;
    }
    expect(await cartesA()).toEqual([]);
  });

  it("refuse une famille en brouillon", async () => {
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(`UPDATE "Famille" SET "finaliseeLe" = NULL WHERE id = $1`, [a.familleId]),
    );
    await expect(imprimer()).rejects.toThrow(ImpressionRefusee);
    expect(await cartesA()).toEqual([]);
  });

  it("isolation A/B : l'église A ne peut pas imprimer la carte d'une famille de B", async () => {
    await expect(imprimerCartesFamille(dbA, AUTEUR, b.familleId, EGLISE)).rejects.toThrow(
      "Famille introuvable. Rechargez la page.",
    );
    const cartesB = await enEglise(proprietaire, b.egliseId, () =>
      proprietaire.query(`SELECT count(*)::int AS n FROM "CarteFamille"`),
    );
    expect(cartesB.rows[0].n).toBe(0);
  });
});

/**
 * Card lifecycle (RG-16, ADR 0008) through the scoped client and the services:
 * pending → active → revoked, read-only verification, at most one active card per child.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { empreinteJeton } from "@/lib/jetons";
import { RequeteHorsEglise, clientEglise, type ClientEglise } from "@/lib/tenant";
import {
  CarteImpossible,
  activerAuPremierScan,
  activerCarte,
  declarerCartePerdue,
  emettreCarte,
} from "@/server/cartes/cycle";
import { MESSAGES_SCAN, resoudreJeton } from "@/server/cartes/resolution";
import { rechercheBadge } from "@/server/plateforme/badges";
import { creerClientPlateforme } from "@/server/plateforme/db";
import { type Client, type Jeu, connecter, creerEglise, enEglise, viderBase } from "./support/db";
import { urlsDeTest } from "./support/urls";

let base: PrismaClient;
let proprietaire: Client;
let a: Jeu;
let b: Jeu;
let dbA: ClientEglise;

const AUTEUR = { userId: "user_test", appareil: null };
const ENFANT_2 = () => `${a.enfantId}_2`;

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
  await enEglise(proprietaire, a.egliseId, () =>
    proprietaire.query(
      `INSERT INTO "Enfant" (id, "egliseId", matricule, "familleId", prenom, nom, "dateNaissance", "updatedAt")
       VALUES ($1, $2, 'HK-0002', $3, 'Prénom', 'Nom', '2021-01-01', now())`,
      [ENFANT_2(), a.egliseId, a.familleId],
    ),
  );
  dbA = clientEglise(base, a.egliseId);
});

const badgesA = () => rechercheBadge(base, a.egliseId);
const resoudre = (jeton: string, db: ClientEglise = dbA) =>
  resoudreJeton(db, jeton, rechercheBadge(base, db.egliseId));
const emettre = (couverture: { enfantId?: string } = {}, db: ClientEglise = dbA) =>
  db.$tx((tx) => emettreCarte(tx, AUTEUR, { familleId: a.familleId, ...couverture }));
const activer = (carteId: string) => dbA.$tx((tx) => activerCarte(tx, AUTEUR, carteId));

/** Every card and every audit entry of church A, read as the owner inside A. */
async function etatA() {
  return enEglise(proprietaire, a.egliseId, async () => ({
    cartes: (await proprietaire.query(`SELECT * FROM "CarteFamille" ORDER BY id`)).rows,
    audit: (await proprietaire.query(`SELECT * FROM "AuditLog" ORDER BY id`)).rows,
  }));
}

/** Invariant: for each child, at most one active card covers it (family or child card). */
async function cartesActivesParEnfant(): Promise<Record<string, number>> {
  return enEglise(proprietaire, a.egliseId, async () => {
    const { rows } = await proprietaire.query<{ enfant: string; n: number }>(`
      SELECT e.id AS enfant, count(c.id)::int AS n
      FROM "Enfant" e
      LEFT JOIN "CarteFamille" c ON c."familleId" = e."familleId"
        AND c."revoqueeLe" IS NULL AND c."activeLe" IS NOT NULL
        AND (c."enfantId" IS NULL OR c."enfantId" = e.id)
      GROUP BY e.id ORDER BY e.id`);
    return Object.fromEntries(rows.map((r) => [r.enfant, r.n]));
  });
}

async function expectUneCarteActiveAuPlus() {
  for (const [enfant, n] of Object.entries(await cartesActivesParEnfant())) {
    expect(n, enfant).toBeLessThanOrEqual(1);
  }
}

describe("émission", () => {
  it("la première carte d'une famille est active tout de suite", async () => {
    const { jeton, active } = await emettre();
    expect(active).toBe(true);
    expect(await resoudre(jeton)).toMatchObject({ statut: "active", type: "famille" });
    await expectUneCarteActiveAuPlus();
  });

  it("seule l'empreinte du jeton est enregistrée, jamais le jeton en clair", async () => {
    const { jeton, carteId } = await emettre();
    const { cartes } = await etatA();
    const carte = cartes.find((c) => c.id === carteId);
    expect(carte.tokenHash).toBe(empreinteJeton(jeton));
    expect(JSON.stringify(cartes)).not.toContain(jeton);
  });

  it("une famille en brouillon ne reçoit pas de carte", async () => {
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(`UPDATE "Famille" SET "finaliseeLe" = NULL WHERE id = $1`, [a.familleId]),
    );
    await expect(emettre()).rejects.toThrow(CarteImpossible);
  });
});

describe("réimpression dans le même mode", () => {
  it("la nouvelle carte est en attente et l'ancienne reste valide", async () => {
    const ancienne = await emettre();
    const nouvelle = await emettre();
    expect(nouvelle.active).toBe(false);
    expect(await resoudre(ancienne.jeton)).toMatchObject({ statut: "active" });
    expect(await resoudre(nouvelle.jeton)).toMatchObject({ statut: "en_attente" });
    await expectUneCarteActiveAuPlus();
  });

  it("une vérification d'une carte en attente ne modifie rien en base", async () => {
    await emettre();
    const nouvelle = await emettre();
    const avant = await etatA();
    expect(await resoudre(nouvelle.jeton)).toMatchObject({ statut: "en_attente" });
    expect(await resoudre(nouvelle.jeton)).toMatchObject({ statut: "en_attente" });
    expect(await etatA()).toEqual(avant);
  });

  it("« Remettre la carte » active la nouvelle et révoque l'ancienne, avec audit, en une transaction", async () => {
    const ancienne = await emettre();
    const nouvelle = await emettre();
    const { revoquees } = await activer(nouvelle.carteId);
    expect(revoquees).toEqual([ancienne.carteId]);
    expect(await resoudre(ancienne.jeton)).toEqual({ statut: "revoquee" });
    expect(await resoudre(nouvelle.jeton)).toMatchObject({ statut: "active" });

    const { audit } = await etatA();
    const actions = audit.map((e) => `${e.action}:${e.entiteId}`);
    expect(actions).toContain(`carte.revoquee:${ancienne.carteId}`);
    expect(actions).toContain(`carte.activee:${nouvelle.carteId}`);
    // No personal data in the audit trail: identifiers only.
    expect(JSON.stringify(audit)).not.toMatch(/Prénom|Nom a|Famille a/);
    await expectUneCarteActiveAuPlus();
  });

  it("si l'activation échoue, rien n'est révoqué (même transaction)", async () => {
    const ancienne = await emettre();
    const nouvelle = await emettre();
    await expect(
      dbA.$tx(async (tx) => {
        await activerCarte(tx, AUTEUR, nouvelle.carteId);
        throw new Error("panne simulée");
      }),
    ).rejects.toThrow("panne simulée");
    expect(await resoudre(ancienne.jeton)).toMatchObject({ statut: "active" });
    expect(await resoudre(nouvelle.jeton)).toMatchObject({ statut: "en_attente" });
  });

  it("deux réimpressions successives ne laissent qu'une carte en attente", async () => {
    await emettre();
    const premiere = await emettre();
    const seconde = await emettre();
    expect(await resoudre(premiere.jeton)).toEqual({ statut: "revoquee" });
    expect(await resoudre(seconde.jeton)).toMatchObject({ statut: "en_attente" });
  });

  it("une carte déjà active ne peut pas être « remise » une seconde fois", async () => {
    const { carteId } = await emettre();
    await expect(activer(carteId)).rejects.toThrow(CarteImpossible);
  });
});

describe("carte perdue", () => {
  it("révoque l'ancienne tout de suite et émet une carte active", async () => {
    const ancienne = await emettre();
    const enAttente = await emettre();
    const perdue = await dbA.$tx((tx) =>
      declarerCartePerdue(tx, AUTEUR, { familleId: a.familleId }),
    );
    expect(perdue.revoquees).toEqual([ancienne.carteId]);
    expect(await resoudre(ancienne.jeton)).toEqual({ statut: "revoquee" });
    expect(await resoudre(enAttente.jeton)).toEqual({ statut: "revoquee" });
    expect(await resoudre(perdue.jeton)).toMatchObject({ statut: "active", type: "famille" });
    await expectUneCarteActiveAuPlus();
  });
});

describe("passage d'un type de carte à l'autre", () => {
  it("famille → enfant → famille : une seule carte active par enfant à chaque étape", async () => {
    const famille = await emettre();
    await expectUneCarteActiveAuPlus();

    // Child cards are pending while the family card is in circulation.
    const enfant1 = await emettre({ enfantId: a.enfantId });
    const enfant2 = await emettre({ enfantId: ENFANT_2() });
    expect([enfant1.active, enfant2.active]).toEqual([false, false]);
    expect(await resoudre(enfant1.jeton)).toMatchObject({
      statut: "en_attente",
      type: "enfant",
      enfantId: a.enfantId,
    });

    // Handing over the first child card revokes the family card.
    await activer(enfant1.carteId);
    expect(await resoudre(famille.jeton)).toEqual({ statut: "revoquee" });
    await expectUneCarteActiveAuPlus();
    await activer(enfant2.carteId);
    expect(await cartesActivesParEnfant()).toEqual({ [a.enfantId]: 1, [ENFANT_2()]: 1 });

    // Back to a family card: it revokes both child cards when handed over.
    const retour = await emettre();
    expect(retour.active).toBe(false);
    const { revoquees } = await activer(retour.carteId);
    expect(revoquees.sort()).toEqual([enfant1.carteId, enfant2.carteId].sort());
    expect(await cartesActivesParEnfant()).toEqual({ [a.enfantId]: 1, [ENFANT_2()]: 1 });
  });

  it("deux activations concurrentes gardent une seule carte active par enfant", async () => {
    await emettre();
    const enfant = await emettre({ enfantId: a.enfantId });
    const famille = await emettre();
    const resultats = await Promise.allSettled([activer(enfant.carteId), activer(famille.carteId)]);
    expect(resultats.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    await expectUneCarteActiveAuPlus();
  });
});

describe("premier scan de check-in ou de check-out (lot 2)", () => {
  it("activerAuPremierScan active une carte en attente et révoque l'ancienne", async () => {
    const ancienne = await emettre();
    const nouvelle = await emettre();
    const resolution = await dbA.$tx((tx) =>
      activerAuPremierScan(tx, AUTEUR, nouvelle.jeton, badgesA()),
    );
    expect(resolution).toMatchObject({ statut: "active", carteId: nouvelle.carteId });
    expect(await resoudre(ancienne.jeton)).toEqual({ statut: "revoquee" });
  });

  it("ne touche pas à une carte déjà active", async () => {
    const { jeton } = await emettre();
    const avant = await etatA();
    await dbA.$tx((tx) => activerAuPremierScan(tx, AUTEUR, jeton, badgesA()));
    expect(await etatA()).toEqual(avant);
  });
});

describe("résolution d'un scan", () => {
  it("RG-14 : une carte de l'église B est reconnue comme appartenant à une autre église", async () => {
    const dbB = clientEglise(base, b.egliseId);
    const carteB = await dbB.$tx((tx) => emettreCarte(tx, AUTEUR, { familleId: b.familleId }));
    expect(await resoudre(carteB.jeton)).toEqual({ statut: "autre_eglise" });
    expect(MESSAGES_SCAN.autre_eglise).toBe("Cette carte n'appartient pas à cette église.");
  });

  it("un jeton inconnu ou une valeur quelconque est « inconnue »", async () => {
    expect(await resoudre("HKF1.ZZZZZZZZZZZZZZZZZZZZZZ")).toEqual({ statut: "inconnue" });
    expect(await resoudre("HK-0001")).toEqual({ statut: "inconnue" });
    expect(await resoudre("")).toEqual({ statut: "inconnue" });
  });

  it("RG-16 : après la date limite d'une réémission, l'ancienne carte est refusée sans écriture", async () => {
    const ancienne = await emettre();
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "ReemissionCartes" (id, "egliseId", mode, "dateLimite", "creePar")
         VALUES ('reemission_a', $1, 'ENFANT', now() - interval '1 day', 'user_test')`,
        [a.egliseId],
      ),
    );
    await dbA.$tx((tx) =>
      emettreCarte(
        tx,
        AUTEUR,
        { familleId: a.familleId, enfantId: a.enfantId },
        {
          reemissionId: "reemission_a",
        },
      ),
    );
    const avant = await etatA();
    expect(await resoudre(ancienne.jeton)).toEqual({ statut: "perimee" });
    expect(await etatA()).toEqual(avant);
  });

  it("avant la date limite, l'ancienne carte reste valide", async () => {
    const ancienne = await emettre();
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "ReemissionCartes" (id, "egliseId", mode, "dateLimite", "creePar")
         VALUES ('reemission_a', $1, 'ENFANT', now() + interval '7 days', 'user_test')`,
        [a.egliseId],
      ),
    );
    await dbA.$tx((tx) =>
      emettreCarte(
        tx,
        AUTEUR,
        { familleId: a.familleId, enfantId: a.enfantId },
        {
          reemissionId: "reemission_a",
        },
      ),
    );
    expect(await resoudre(ancienne.jeton)).toMatchObject({ statut: "active" });
  });
});

describe("isolation A/B des réémissions", () => {
  it("l'église A ne voit ni ne crée de réémission de l'église B", async () => {
    await enEglise(proprietaire, b.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "ReemissionCartes" (id, "egliseId", mode, "creePar") VALUES ('reemission_b', $1, 'FAMILLE', 'u')`,
        [b.egliseId],
      ),
    );
    expect(await dbA.reemissionCartes.findMany()).toEqual([]);
    expect(await dbA.reemissionCartes.findUnique({ where: { id: "reemission_b" } })).toBeNull();
    await expect(
      dbA.reemissionCartes.create({
        data: { egliseId: b.egliseId, mode: "FAMILLE", creePar: "u" },
      }),
    ).rejects.toThrow(RequeteHorsEglise);
  });

  it("une carte de A ne peut pas être rattachée à une réémission de B (clé composite)", async () => {
    await enEglise(proprietaire, b.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "ReemissionCartes" (id, "egliseId", mode, "creePar") VALUES ('reemission_b', $1, 'FAMILLE', 'u')`,
        [b.egliseId],
      ),
    );
    await expect(
      dbA.$tx((tx) =>
        emettreCarte(tx, AUTEUR, { familleId: a.familleId }, { reemissionId: "reemission_b" }),
      ),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

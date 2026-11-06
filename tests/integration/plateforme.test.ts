/**
 * Step 6: platform console services, local file storage and the demonstration
 * seed, against the real test database (hk_app role, under RLS).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { analyserCle } from "@/lib/fichiers";
import { FORMAT_EMPREINTE, empreinteJeton } from "@/lib/jetons";
import { creerStockageLocal } from "@/lib/storage/local";
import { normaliserTelephone } from "@/lib/telephone";
import { clientEglise } from "@/lib/tenant";
import { creerCompte, rattacherMembre } from "@/server/plateforme/comptes";
import { creerClientPlateforme } from "@/server/plateforme/db";
import {
  changerStatutEglise,
  creerEgliseAvecPremierAdmin,
  listerEglises,
  type NouvelleEglise,
} from "@/server/plateforme/eglises";
import { EGLISES_DEMO, seed } from "../../prisma/seed";
import { BROUILLONS } from "../../prisma/seed-familles";
import { type Client, connecter, creerEglise, enEglise, viderBase } from "./support/db";
import { urlsDeTest } from "./support/urls";

let base: PrismaClient;
let proprietaire: Client;
let dossier: string;
let superAdminId: string;

const nouvelle = (slug: string, email = `admin.${slug}@harvest-kids.test`): NouvelleEglise => ({
  nom: `Église ${slug}`,
  slug,
  fuseau: "Africa/Porto-Novo",
  admin: { nom: "Premier admin", email },
});

beforeAll(async () => {
  base = creerClientPlateforme(urlsDeTest().app);
  proprietaire = await connecter("proprietaire");
  dossier = await mkdtemp(join(tmpdir(), "hk-stockage-"));
});

afterAll(async () => {
  await base?.$disconnect();
  await proprietaire?.end();
  await rm(dossier, { recursive: true, force: true });
});

beforeEach(async () => {
  await viderBase(proprietaire);
  superAdminId = await creerCompte(base, {
    nom: "Super",
    email: "super@harvest-kids.test",
    motDePasse: "Super-admin-2026",
    superAdmin: true,
  });
});

describe("création d'une église depuis la plateforme", () => {
  it("crée l'église, ses classes et cultes par défaut dans cette église seulement, et son administrateur", async () => {
    const autre = await creerEglise(proprietaire, "autre");
    const resultat = await creerEgliseAvecPremierAdmin(base, nouvelle("eglise-test"), superAdminId);
    expect(resultat.statut).toBe("creee");
    if (resultat.statut !== "creee") return;

    const db = clientEglise(base, resultat.egliseId);
    expect(await db.classe.count()).toBe(4);
    expect(await db.culte.count()).toBe(2);
    // The other church only has its own class.
    expect(await clientEglise(base, autre.egliseId).classe.count()).toBe(1);

    const admin = await base.user.findUniqueOrThrow({
      where: { email: "admin.eglise-test@harvest-kids.test" },
      select: {
        membres: { select: { egliseId: true, roles: true } },
        comptes: { select: { password: true } },
        jetonsCompte: { select: { type: true, tokenHash: true, egliseId: true, creePar: true } },
      },
    });
    expect(admin.membres).toEqual([{ egliseId: resultat.egliseId, roles: ["ADMIN"] }]);
    // No password chosen by the super-administrator: a 7-day activation link (ADR 0014).
    expect(admin.comptes).toEqual([]);
    expect(resultat.jeton).toMatch(/^HKC1\./);
    expect(admin.jetonsCompte).toEqual([
      {
        type: "ACTIVATION",
        tokenHash: empreinteJeton(resultat.jeton!),
        egliseId: resultat.egliseId,
        creePar: superAdminId,
      },
    ]);
    const { rows } = await proprietaire.query<{ duree: string }>(
      `SELECT ("expireLe" - "createdAt")::text AS duree FROM "JetonCompte"`,
    );
    expect(rows[0]!.duree).toMatch(/^7 days/);

    const audit = await base.auditPlateforme.findMany({ where: { egliseId: resultat.egliseId } });
    expect(audit).toMatchObject([{ action: "eglise.creer", userId: superAdminId }]);
    // No personal data in the platform log.
    expect(JSON.stringify(audit)).not.toContain("admin.eglise-test");
  });

  it("refuse une adresse courte déjà prise", async () => {
    await creerEgliseAvecPremierAdmin(base, nouvelle("doublon"), superAdminId);
    expect(
      await creerEgliseAvecPremierAdmin(base, nouvelle("doublon", "x@y.test"), superAdminId),
    ).toEqual({ statut: "slug_pris" });
  });

  it("rattache un compte existant d'une autre église au lieu de le dupliquer", async () => {
    const autre = await creerEglise(proprietaire, "autre");
    const existant = await creerCompte(base, {
      nom: "Déjà là",
      email: "deja@harvest-kids.test",
      motDePasse: "Mot-de-passe-2026",
    });
    await rattacherMembre(base, { userId: existant, egliseId: autre.egliseId, roles: ["ACCUEIL"] });

    const resultat = await creerEgliseAvecPremierAdmin(
      base,
      nouvelle("deuxieme", "deja@harvest-kids.test"),
      superAdminId,
    );
    expect(resultat).toMatchObject({ statut: "creee", jeton: null });
    expect(await base.user.count({ where: { email: "deja@harvest-kids.test" } })).toBe(1);
    expect(await base.membre.count({ where: { userId: existant } })).toBe(2);
    expect(await base.jetonCompte.count()).toBe(0);
  });

  it("suspend et réactive une église, avec une trace dans le journal de plateforme", async () => {
    const resultat = await creerEgliseAvecPremierAdmin(base, nouvelle("suspendue"), superAdminId);
    if (resultat.statut !== "creee") throw new Error("création attendue");
    expect(await changerStatutEglise(base, resultat.egliseId, "SUSPENDUE", superAdminId)).toBe(
      true,
    );
    expect((await listerEglises(base)).find((e) => e.id === resultat.egliseId)?.statut).toBe(
      "SUSPENDUE",
    );
    await changerStatutEglise(base, resultat.egliseId, "ACTIVE", superAdminId);
    const actions = await base.auditPlateforme.findMany({
      where: { egliseId: resultat.egliseId },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual([
      "eglise.creer",
      "eglise.suspendre",
      "eglise.reactiver",
    ]);
  });
});

describe("stockage local", () => {
  it("écrit, relit et supprime un fichier sous le préfixe de l'église", async () => {
    const stockage = creerStockageLocal(dossier);
    const cle = "eglises/eglise_a/photos/essai.png";
    await stockage.put(cle, new Uint8Array([1, 2, 3]), "image/png");
    expect(await stockage.get(cle)).toEqual({
      donnees: expect.any(Uint8Array),
      typeContenu: "image/png",
    });
    await stockage.delete(cle);
    expect(await stockage.get(cle)).toBeNull();
  });

  it("refuse toute clé qui sortirait du dossier ou du préfixe d'une église", async () => {
    const stockage = creerStockageLocal(dossier);
    for (const cle of [
      "../secret.png",
      "eglises/a/../../x.png",
      "eglises/a/photos/../../../x.png",
    ]) {
      await expect(stockage.put(cle, new Uint8Array([1]), "image/png")).rejects.toThrow();
      await expect(stockage.get(cle)).rejects.toThrow();
    }
  });
});

describe("seed de démonstration", () => {
  it("crée deux églises de 20 à 40 familles, des matricules séquentiels et isolés, et reste idempotent", async () => {
    const stockage = creerStockageLocal(dossier);
    const premier = await seed(base, stockage);
    expect(premier.eglises).toBe(2);

    const eglises = await base.eglise.findMany({
      where: { slug: { in: EGLISES_DEMO.map((e) => e.slug) } },
      select: { id: true, slug: true, logoKey: true, prochainMatricule: true },
    });
    expect(eglises).toHaveLength(2);

    let total = 0;
    for (const eglise of eglises) {
      const db = clientEglise(base, eglise.id);
      const familles = await db.famille.count({ where: { finaliseeLe: { not: null } } });
      expect(familles).toBeGreaterThanOrEqual(20);
      expect(familles).toBeLessThanOrEqual(40);
      // Drafts as left by a CSV import (ADR 0013): no matricule, no card.
      const brouillons = await db.famille.findMany({
        where: { finaliseeLe: null },
        select: {
          enfants: { select: { matricule: true } },
          tuteurs: { select: { telephone: true } },
        },
      });
      expect(brouillons).toHaveLength(BROUILLONS);
      expect(brouillons.flatMap((f) => f.enfants).every((e) => e.matricule === null)).toBe(true);
      expect(brouillons.flatMap((f) => f.tuteurs).some((t) => t.telephone === null)).toBe(true);
      total += familles + brouillons.length;

      // Every stored number is valid E.164 (ADR 0011).
      const numeros = await db.tuteur.findMany({
        where: { telephone: { not: null } },
        select: { telephone: true },
      });
      for (const { telephone } of numeros) {
        expect(normaliserTelephone(telephone!, "229"), telephone!).toEqual({
          statut: "valide",
          e164: telephone,
        });
      }

      // RG-01: HK-0001…HK-N without gaps, per church.
      const matricules = (
        await db.enfant.findMany({
          where: { matricule: { not: null } },
          select: { matricule: true },
        })
      )
        .map((e) => e.matricule)
        .sort();
      expect(matricules[0]).toBe("HK-0001");
      expect(matricules.at(-1)).toBe(`HK-${String(matricules.length).padStart(4, "0")}`);
      expect(eglise.prochainMatricule).toBe(matricules.length + 1);

      // Every authorised adult has a photo stored under the church's own prefix.
      const autorises = await db.personneAutorisee.findMany({ select: { photoKey: true } });
      for (const { photoKey } of autorises) {
        expect(analyserCle(photoKey)?.egliseId).toBe(eglise.id);
        expect(await stockage.get(photoKey)).not.toBeNull();
      }

      // RG-02 and ADR 0008: one active family card per family, fingerprint only.
      const cartes = await db.carteFamille.findMany({
        select: { tokenHash: true, activeLe: true, enfantId: true },
      });
      expect(cartes).toHaveLength(familles);
      expect(cartes.every((c) => FORMAT_EMPREINTE.test(c.tokenHash))).toBe(true);
      expect(cartes.every((c) => c.activeLe !== null && c.enfantId === null)).toBe(true);
    }
    expect(premier.familles).toBe(total);

    // Church A has a logo, church B none.
    const parSlug = Object.fromEntries(eglises.map((e) => [e.slug, e]));
    expect(parSlug["demo-cotonou"]?.logoKey).toMatch(/^eglises\/.+\/logo\/logo\.png$/);
    expect(parSlug["demo-porto-novo"]?.logoKey).toBeNull();

    const second = await seed(base, stockage);
    expect(second).toMatchObject({ comptesCrees: 0, familles: 0, telephonesRepares: 0 });

    // A database seeded before the ten-digit numbers (Neon): the seed repairs them, once.
    const numeros = async () => {
      const tous: { telephone: string | null; whatsapp: string | null }[] = [];
      for (const { id } of eglises) {
        const { rows } = await enEglise(proprietaire, id, () =>
          proprietaire.query<(typeof tous)[number]>(
            `SELECT "telephone", "whatsapp" FROM "Tuteur" ORDER BY "id"`,
          ),
        );
        tous.push(...rows);
      }
      return tous;
    };
    const avant = await numeros();
    const anciens = avant.filter((t) => t.telephone?.startsWith("+22901960")).length;
    expect(anciens).toBeGreaterThan(0);
    for (const { id } of eglises) {
      await enEglise(proprietaire, id, () =>
        proprietaire.query(
          `UPDATE "Tuteur" SET "telephone" = left("telephone", -1), "whatsapp" = left("whatsapp", -1)
             WHERE "telephone" LIKE '+22901960%'`,
        ),
      );
    }
    // "+229" and 9 national digits.
    expect((await numeros()).some((t) => t.telephone?.length === 13)).toBe(true);
    expect((await seed(base, stockage)).telephonesRepares).toBe(anciens);
    expect(await numeros()).toEqual(avant);
    expect((await seed(base, stockage)).telephonesRepares).toBe(0);
  }, 240_000);
});

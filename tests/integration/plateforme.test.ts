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
import { estJetonCarte } from "@/lib/jetons";
import { creerStockageLocal } from "@/lib/storage/local";
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
import { type Client, connecter, creerEglise, viderBase } from "./support/db";
import { urlsDeTest } from "./support/urls";

let base: PrismaClient;
let proprietaire: Client;
let dossier: string;
let superAdminId: string;

const nouvelle = (slug: string, email = `admin.${slug}@harvest-kids.test`): NouvelleEglise => ({
  nom: `Église ${slug}`,
  slug,
  fuseau: "Africa/Porto-Novo",
  admin: { nom: "Premier admin", email, motDePasse: "Provisoire-2026" },
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
      select: { membres: { select: { egliseId: true, roles: true } } },
    });
    expect(admin.membres).toEqual([{ egliseId: resultat.egliseId, roles: ["ADMIN"] }]);

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
    expect(resultat.statut).toBe("creee");
    expect(await base.user.count({ where: { email: "deja@harvest-kids.test" } })).toBe(1);
    expect(await base.membre.count({ where: { userId: existant } })).toBe(2);
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
      const familles = await db.famille.count();
      expect(familles).toBeGreaterThanOrEqual(20);
      expect(familles).toBeLessThanOrEqual(40);
      total += familles;

      // RG-01: HK-0001…HK-N without gaps, per church.
      const matricules = (await db.enfant.findMany({ select: { matricule: true } }))
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

      // RG-02: one active card per family, opaque token.
      const cartes = await db.carteFamille.findMany({ select: { token: true } });
      expect(cartes).toHaveLength(familles);
      expect(cartes.every((c) => estJetonCarte(c.token))).toBe(true);
    }
    expect(premier.familles).toBe(total);

    // Church A has a logo, church B none.
    const parSlug = Object.fromEntries(eglises.map((e) => [e.slug, e]));
    expect(parSlug["demo-cotonou"]?.logoKey).toMatch(/^eglises\/.+\/logo\/logo\.png$/);
    expect(parSlug["demo-porto-novo"]?.logoKey).toBeNull();

    const second = await seed(base, stockage);
    expect(second).toMatchObject({ comptesCrees: 0, familles: 0 });
  }, 240_000);
});

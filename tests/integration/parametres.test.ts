/**
 * Church settings (cahier §7.10, RG-16, RG-17): settings, classes, profile and logos,
 * with their audit entries and church A / church B isolation.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { creerStockageLocal } from "@/lib/storage/local";
import { RequeteHorsEglise, clientEglise, type ClientEglise } from "@/lib/tenant";
import { creerClasse, listerClasses, modifierClasse } from "@/server/classes";
import { PARAMETRES_PAR_DEFAUT, ecrireParametre, lireParametres } from "@/server/parametres";
import { creerClientPlateforme } from "@/server/plateforme/db";
import {
  LOGO_TAILLE_MAX,
  LogoRefuse,
  ProfilRefuse,
  convertirLogo,
  lireProfilEglise,
  modifierProfilEglise,
  remplacerLogo,
} from "@/server/plateforme/profil-eglise";
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
let dbB: ClientEglise;
let dossier: string;

const auteur = contexteVerifie;

beforeAll(async () => {
  base = creerClientPlateforme(urlsDeTest().app);
  proprietaire = await connecter("proprietaire");
  dossier = await mkdtemp(join(tmpdir(), "hk-parametres-"));
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
  dbB = clientEglise(base, b.egliseId);
});

/** Audit entries of a church, read as the owner inside it. */
const audit = (jeu: Jeu) =>
  enEglise(proprietaire, jeu.egliseId, async () => {
    const { rows } = await proprietaire.query(
      `SELECT action, entite, "entiteId", avant, apres FROM "AuditLog" ORDER BY "createdAt", id`,
    );
    return rows;
  });

describe("paramètres", () => {
  it("une église sans paramètre enregistré a les valeurs par défaut", async () => {
    expect(await lireParametres(dbA)).toEqual(PARAMETRES_PAR_DEFAUT);
  });

  it("une valeur enregistrée invalide retombe sur la valeur par défaut", async () => {
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "Parametre" ("egliseId", cle, valeur) VALUES ($1, 'cartes.mode', '"CLASSE"')`,
        [a.egliseId],
      ),
    );
    expect((await lireParametres(dbA))["cartes.mode"]).toBe("FAMILLE");
  });

  it("enregistre une valeur avec son audit (avant, après)", async () => {
    await dbA.$tx((tx) => ecrireParametre(tx, auteur(a), "cartes.mode", "ENFANT"));
    await dbA.$tx((tx) =>
      ecrireParametre(tx, auteur(a), "impression", { format: "CR80", rectoVerso: true }),
    );
    await dbA.$tx((tx) => ecrireParametre(tx, auteur(a), "cartes.mode", "FAMILLE"));

    expect(await lireParametres(dbA)).toMatchObject({
      "cartes.mode": "FAMILLE",
      impression: { format: "CR80", rectoVerso: true },
    });
    expect(await audit(a)).toEqual([
      {
        action: "parametre.modifie",
        entite: "Parametre",
        entiteId: "cartes.mode",
        avant: null,
        apres: "ENFANT",
      },
      {
        action: "parametre.modifie",
        entite: "Parametre",
        entiteId: "impression",
        avant: null,
        apres: { format: "CR80", rectoVerso: true },
      },
      {
        action: "parametre.modifie",
        entite: "Parametre",
        entiteId: "cartes.mode",
        avant: "ENFANT",
        apres: "FAMILLE",
      },
    ]);
  });

  it("refuse une valeur invalide sans rien écrire", async () => {
    await expect(
      dbA.$tx((tx) => ecrireParametre(tx, auteur(a), "familles.delaiPurgeBrouillonsJours", 2)),
    ).rejects.toThrow(ZodError);
    expect(await audit(a)).toEqual([]);
  });

  it("isolation A/B : les paramètres de A n'affectent pas B", async () => {
    await dbA.$tx((tx) => ecrireParametre(tx, auteur(a), "cartes.mode", "ENFANT"));
    expect((await lireParametres(dbB))["cartes.mode"]).toBe("FAMILLE");
    expect(await audit(b)).toEqual([]);
  });

  it("textes de carte : enregistrés nettoyés, refusés trop longs, propres à chaque église", async () => {
    const textes = {
      afficherTelephone: false,
      consigneCourte: "  Carte à présenter à l'accueil.  ",
      titreVerso: "Accueil des enfants",
      consignesVerso: ["Présentez la carte.", "Signalez une carte perdue."],
    };
    await dbA.$tx((tx) => ecrireParametre(tx, auteur(a), "cartes.textes", textes));
    expect((await lireParametres(dbA))["cartes.textes"]).toEqual({
      ...textes,
      consigneCourte: "Carte à présenter à l'accueil.",
    });
    await expect(
      dbA.$tx((tx) =>
        ecrireParametre(tx, auteur(a), "cartes.textes", { ...textes, titreVerso: "x".repeat(41) }),
      ),
    ).rejects.toThrow(ZodError);
    expect((await lireParametres(dbB))["cartes.textes"]).toEqual(
      PARAMETRES_PAR_DEFAUT["cartes.textes"],
    );
    expect(await audit(b)).toEqual([]);
  });

  it("isolation A/B : une requête forcée sur un paramètre de B est refusée", async () => {
    await dbB.$tx((tx) => ecrireParametre(tx, auteur(b), "cartes.mode", "ENFANT"));
    const cleB = { egliseId_cle: { egliseId: b.egliseId, cle: "cartes.mode" } };
    await expect(dbA.parametre.findUnique({ where: cleB })).rejects.toThrow(RequeteHorsEglise);
    await expect(
      dbA.parametre.upsert({
        where: cleB,
        create: { cle: "cartes.mode", valeur: "FAMILLE" } as never,
        update: { valeur: "FAMILLE" },
      }),
    ).rejects.toThrow(RequeteHorsEglise);
    await expect(
      dbA.parametre.updateMany({ where: { egliseId: b.egliseId }, data: { valeur: "FAMILLE" } }),
    ).rejects.toThrow(RequeteHorsEglise);
    // Without naming B, a write only reaches A's rows.
    await dbA.parametre.updateMany({ where: { cle: "cartes.mode" }, data: { valeur: "FAMILLE" } });
    expect((await lireParametres(dbB))["cartes.mode"]).toBe("ENFANT");
  });
});

describe("classes et tranches d'âge (RG-17)", () => {
  const saisie = {
    nom: "Grands",
    ageMinMois: 108,
    ageMaxMois: 155,
    salle: "Salle 4",
    capacite: 25,
    minMoniteurs: 2,
    ordre: 4,
    active: true,
  };

  it("crée et modifie une classe, avec l'audit", async () => {
    const { id } = await dbA.$tx((tx) => creerClasse(tx, auteur(a), saisie));
    expect(
      await dbA.$tx((tx) =>
        modifierClasse(tx, auteur(a), id, { ...saisie, ageMaxMois: 143, active: false }),
      ),
    ).toBe(true);

    const classe = (await listerClasses(dbA)).find((c) => c.id === id);
    expect(classe).toMatchObject({ ageMaxMois: 143, active: false, salle: "Salle 4" });
    const entrees = await audit(a);
    expect(entrees.map((e) => e.action)).toEqual(["classe.creee", "classe.modifiee"]);
    expect(entrees[1]).toMatchObject({
      avant: { ageMaxMois: 155, active: true },
      apres: { ageMaxMois: 143, active: false },
    });
  });

  it("modifier une tranche ne déplace aucune présence existante", async () => {
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut, "codeRetrait", "checkinPar")
         VALUES ('p_1', $1, $2, $3, $4, 'PRESENT', 'K7RM', 'user_test')`,
        [a.egliseId, a.sessionId, a.enfantId, a.classeId],
      ),
    );
    await dbA.$tx((tx) =>
      modifierClasse(tx, auteur(a), a.classeId, { ...saisie, ageMinMois: 0, ageMaxMois: 11 }),
    );
    const { rows } = await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(`SELECT "classeId" FROM "Presence" WHERE id = 'p_1'`),
    );
    expect(rows).toEqual([{ classeId: a.classeId }]);
  });

  it("refuse une saisie invalide sans rien écrire", async () => {
    await expect(
      dbA.$tx((tx) => creerClasse(tx, auteur(a), { ...saisie, ageMaxMois: 10 })),
    ).rejects.toThrow(ZodError);
    expect(await audit(a)).toEqual([]);
  });

  it("isolation A/B : A ne voit pas et ne modifie pas une classe de B", async () => {
    expect((await listerClasses(dbA)).map((c) => c.id)).toEqual([a.classeId]);
    expect(await dbA.$tx((tx) => modifierClasse(tx, auteur(a), b.classeId, saisie))).toBe(false);
    const { rows } = await enEglise(proprietaire, b.egliseId, () =>
      proprietaire.query(`SELECT nom FROM "Classe" WHERE id = $1`, [b.classeId]),
    );
    expect(rows).toEqual([{ nom: "3–5 ans" }]);
    expect(await audit(a)).toEqual([]);
  });
});

describe("profil de l'église", () => {
  const profil = {
    nom: "Église A modifiée",
    adresse: "Rue des Cocotiers",
    telephoneAccueil: "01 97 45 12 33",
    fuseau: "Africa/Lagos",
  };

  it("modifie le profil de l'église active seulement, avec l'audit dans cette église", async () => {
    await modifierProfilEglise(base, auteur(a), profil);
    // The reception phone is stored in E.164, with the church's default country code.
    expect(await lireProfilEglise(base, auteur(a))).toMatchObject({
      ...profil,
      telephoneAccueil: "+2290197451233",
    });
    expect((await lireProfilEglise(base, auteur(b))).nom).toBe("Église b");

    const entrees = await audit(a);
    expect(entrees).toHaveLength(1);
    expect(entrees[0]).toMatchObject({
      action: "eglise.profil_modifie",
      entite: "Eglise",
      entiteId: a.egliseId,
      avant: { nom: "Église a" },
      apres: { nom: "Église A modifiée" },
    });
    expect(await audit(b)).toEqual([]);
  });

  it("refuse un téléphone invalide ou béninois à 8 chiffres, sans rien écrire", async () => {
    await expect(
      modifierProfilEglise(base, auteur(a), { ...profil, telephoneAccueil: "abc" }),
    ).rejects.toThrow(ProfilRefuse);
    await expect(
      modifierProfilEglise(base, auteur(a), { ...profil, telephoneAccueil: "97 45 12 33" }),
    ).rejects.toThrow("Voulez-vous dire 01 97 45 12 33 ?");
    expect((await lireProfilEglise(base, auteur(a))).nom).toBe("Église a");
    expect(await audit(a)).toEqual([]);
  });
});

describe("logos", () => {
  const svg = (couleur: string) =>
    new TextEncoder().encode(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><script>alert(1)</script><rect width="200" height="100" fill="${couleur}"/></svg>`,
    );

  it("un SVG est converti en PNG : le SVG n'est jamais stocké", async () => {
    const png = await convertirLogo({ type: "image/svg+xml", octets: svg("#123456") });
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.toString("latin1")).not.toContain("<script");
    expect((await sharp(png).metadata()).format).toBe("png");
  });

  it("refuse un autre type, un fichier illisible ou trop lourd, avec un message qui dit quoi faire", async () => {
    await expect(convertirLogo({ type: "image/jpeg", octets: svg("#000") })).rejects.toThrow(
      "Choisissez un logo au format PNG ou SVG.",
    );
    await expect(
      convertirLogo({ type: "image/png", octets: new TextEncoder().encode("pas une image") }),
    ).rejects.toThrow(LogoRefuse);
    await expect(
      convertirLogo({ type: "image/png", octets: new Uint8Array(LOGO_TAILLE_MAX + 1) }),
    ).rejects.toThrow("Le logo dépasse 2 Mo. Choisissez un fichier plus léger.");
  });

  it("remplace le logo sous une nouvelle clé, programme la suppression de l'ancien dans 24 h et journalise", async () => {
    const stockage = creerStockageLocal(dossier);
    const premier = await convertirLogo({ type: "image/svg+xml", octets: svg("#111111") });
    await remplacerLogo(base, stockage, auteur(a), "principal", premier);
    const cle1 = (await lireProfilEglise(base, auteur(a))).logoKey!;
    expect(cle1).toMatch(new RegExp(`^eglises/${a.egliseId}/logo/principal-.+\\.png$`));
    expect(await stockage.get(cle1)).not.toBeNull();

    const second = await convertirLogo({ type: "image/svg+xml", octets: svg("#222222") });
    await remplacerLogo(base, stockage, auteur(a), "principal", second);
    const cle2 = (await lireProfilEglise(base, auteur(a))).logoKey!;
    expect(cle2).not.toBe(cle1);
    // The old file stays served (tablets still showing the old page) until the daily task
    // deletes it, at least 24 hours later.
    expect(await stockage.get(cle1)).not.toBeNull();
    const programmes = await dbA.fichierASupprimer.findMany({
      select: { cle: true, apresLe: true },
    });
    expect(programmes.map((p) => p.cle)).toEqual([cle1]);
    expect(programmes[0]!.apresLe.getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    expect(await stockage.get(cle2)).not.toBeNull();

    // Removing the light variant empties it; church B is untouched.
    await remplacerLogo(base, stockage, auteur(a), "clair", null);
    expect((await lireProfilEglise(base, auteur(b))).logoKey).toBeNull();
    expect((await audit(a)).map((e) => e.action)).toEqual([
      "eglise.logo_remplace",
      "eglise.logo_remplace",
      "eglise.logo_supprime",
    ]);
  });
});

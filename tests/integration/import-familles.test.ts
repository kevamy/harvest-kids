/**
 * Family import (cahier §7.1, ADR 0013) on PostgreSQL: read-only preview, drafts without
 * matricule or card, numbers left empty unless confirmed, duplicates left out unless ticked,
 * same file required, audit without personal data, finalisation, purge, isolation A/B.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { creerStockageLocal } from "@/lib/storage/local";
import { clientEglise, type ClientEglise } from "@/lib/tenant";
import {
  creerBrouillon,
  enregistrerFamille,
  lireFamille,
  purgerBrouillonsExpires,
  type FichierRecu,
} from "@/server/familles";
import { ImportRefuse, idCorrection } from "@/server/import-familles/analyse";
import { analyserImport, importerFamilles } from "@/server/import-familles/service";
import { creerClientPlateforme } from "@/server/plateforme/db";
import { type Client, type Jeu, connecter, creerEglise, enEglise, viderBase } from "./support/db";
import { urlsDeTest } from "./support/urls";

let base: PrismaClient;
let proprietaire: Client;
let a: Jeu;
let b: Jeu;
let dbA: ClientEglise;
let dbB: ClientEglise;

const AUTEUR = { userId: "user_test", appareil: null };
const ENTETE =
  "Nom de famille;Prénom de l'enfant;Nom de l'enfant;Date de naissance;Sexe;Prénom tuteur 1;Nom tuteur 1;Lien tuteur 1;Téléphone tuteur 1;Prénom tuteur 2;Nom tuteur 2;Lien tuteur 2;Téléphone tuteur 2";
const fichier = (...lignes: string[]) => new TextEncoder().encode([ENTETE, ...lignes].join("\r\n"));

// Three families: siblings with a full number, a number to confirm, an unreadable number.
const TROIS_FAMILLES = fichier(
  "Ahouansou;Grâce;Ahouansou;14/03/2019;F;Rachel;Ahouansou;Mère;01 97 45 12 33;Paul;Ahouansou;Père;",
  "Ahouansou;Daniel;Ahouansou;2/9/2021;M;Rachel;Ahouansou;Mère;01 97 45 12 33;;;;",
  "Dossou;Ayo;Dossou;1/2/2020;;Rita;Dossou;Tante;66 77 88 99;;;;",
  "Houngbo;Délali;Houngbo;5/5/2018;F;Marc;Houngbo;Père;illisible;;;;",
  "Houngbo;;Houngbo;5/5/2018;F;Marc;Houngbo;Père;;;;;",
);

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
  await proprietaire.query(`UPDATE "Eglise" SET "prochainMatricule" = 2`);
  dbA = clientEglise(base, a.egliseId);
  dbB = clientEglise(base, b.egliseId);
});

const compter = async (db: ClientEglise) => ({
  familles: await db.famille.count(),
  tuteurs: await db.tuteur.count(),
  enfants: await db.enfant.count(),
  audit: await db.auditLog.count(),
});

const brouillonsDe = (db: ClientEglise) =>
  db.famille.findMany({
    where: { finaliseeLe: null },
    orderBy: { nom: "asc" },
    select: {
      id: true,
      nom: true,
      tuteurs: {
        orderBy: { principal: "desc" },
        select: { prenom: true, telephone: true, principal: true },
      },
      enfants: {
        orderBy: { prenom: "asc" },
        select: { prenom: true, matricule: true, sexe: true, dateNaissance: true },
      },
      cartes: { select: { id: true } },
    },
  });

describe("prévisualisation", () => {
  it("lit le fichier sans rien écrire", async () => {
    const avant = await compter(dbA);
    const apercu = await analyserImport(dbA, TROIS_FAMILLES);
    expect(apercu.familles.map((f) => f.nom)).toEqual(["Ahouansou", "Dossou", "Houngbo"]);
    expect(apercu.rejets).toEqual([
      { ligne: 6, message: expect.stringContaining("Nom de l'enfant manquant") },
    ]);
    expect(apercu.empreinte).toMatch(/^[0-9a-f]{64}$/);
    expect(await compter(dbA)).toEqual(avant);
  });
});

describe("import en brouillons", () => {
  it("crée des brouillons sans matricule ni carte ; numéros non confirmés ou illisibles laissés vides", async () => {
    const apercu = await analyserImport(dbA, TROIS_FAMILLES);
    const rapport = await importerFamilles(dbA, AUTEUR, TROIS_FAMILLES, {
      empreinte: apercu.empreinte,
      corrections: [],
      doublons: [],
    });
    expect(rapport.importees.map((f) => [f.nom, f.nonValides])).toEqual([
      ["Ahouansou", 0],
      ["Dossou", 1],
      ["Houngbo", 0],
    ]);
    expect(rapport.rejets.map((r) => r.ligne)).toEqual([6]);

    const brouillons = await brouillonsDe(dbA);
    expect(brouillons.map((f) => f.nom)).toEqual(["Ahouansou", "Dossou", "Houngbo"]);
    expect(brouillons[0]!.tuteurs).toEqual([
      { prenom: "Rachel", telephone: "+2290197451233", principal: true },
      { prenom: "Paul", telephone: null, principal: false },
    ]);
    expect(brouillons[0]!.enfants).toEqual([
      { prenom: "Daniel", matricule: null, sexe: "M", dateNaissance: new Date("2021-09-02") },
      { prenom: "Grâce", matricule: null, sexe: "F", dateNaissance: new Date("2019-03-14") },
    ]);
    expect(brouillons[1]!.tuteurs[0]!.telephone).toBeNull(); // correction not validated
    expect(brouillons[2]!.tuteurs[0]!.telephone).toBeNull(); // unreadable
    expect(brouillons.flatMap((f) => f.cartes)).toEqual([]);
    expect(brouillons.flatMap((f) => f.enfants).every((e) => e.matricule === null)).toBe(true);
  });

  it("une correction validée enregistre le numéro proposé", async () => {
    const apercu = await analyserImport(dbA, TROIS_FAMILLES);
    await importerFamilles(dbA, AUTEUR, TROIS_FAMILLES, {
      empreinte: apercu.empreinte,
      corrections: [idCorrection("F2", 0)],
      doublons: [],
    });
    const dossou = await dbA.famille.findFirstOrThrow({
      where: { nom: "Dossou" },
      select: { tuteurs: { select: { telephone: true } } },
    });
    expect(dossou.tuteurs).toEqual([{ telephone: "+2290166778899" }]);
  });

  it("l'audit compte sans aucune donnée personnelle", async () => {
    const apercu = await analyserImport(dbA, TROIS_FAMILLES);
    await importerFamilles(dbA, AUTEUR, TROIS_FAMILLES, {
      empreinte: apercu.empreinte,
      corrections: [],
      doublons: [],
    });
    const entrees = await dbA.auditLog.findMany({
      orderBy: { createdAt: "asc" },
      select: { action: true, entiteId: true, apres: true },
    });
    expect(entrees.filter((e) => e.action === "famille.brouillon_cree")).toHaveLength(3);
    const bilan = entrees.find((e) => e.action === "familles.importees")!;
    expect(bilan.entiteId).toBe(apercu.empreinte);
    expect(bilan.apres).toEqual({
      encodage: "utf-8",
      lignes: 5,
      familles: 3,
      enfants: 4,
      ecartees: 0,
      rejets: 1,
      numerosNonValides: 1,
    });
    const texte = JSON.stringify(entrees);
    for (const donnee of ["Ahouansou", "Rachel", "Grâce", "0197451233", "illisible"]) {
      expect(texte).not.toContain(donnee);
    }
  });

  it("refuse un fichier modifié depuis la prévisualisation, ou des choix incomplets", async () => {
    const apercu = await analyserImport(dbA, TROIS_FAMILLES);
    const modifie = fichier("Agossou;Ayo;Agossou;1/2/2020");
    await expect(
      importerFamilles(dbA, AUTEUR, modifie, {
        empreinte: apercu.empreinte,
        corrections: [],
        doublons: [],
      }),
    ).rejects.toThrow("Le fichier a changé depuis la prévisualisation.");
    await expect(
      importerFamilles(dbA, AUTEUR, TROIS_FAMILLES, { corrections: [] }),
    ).rejects.toThrow(ZodError);
    expect(await dbA.famille.count({ where: { finaliseeLe: null } })).toBe(0);
  });
});

describe("doublons possibles", () => {
  const existante = (db: ClientEglise) =>
    db.$tx((tx) =>
      creerBrouillon(tx, AUTEUR, "229", {
        nom: "Kpadé",
        tuteurs: [
          { prenom: "Rita", nom: "Kpadé", lien: "Mère", telephone: "0166778899", principal: true },
        ],
        enfants: [{ prenom: "Abla", nom: "Kpadé", dateNaissance: new Date("2019-01-01") }],
      }),
    );
  const memeTelephone = fichier("Dossou;Ayo;Dossou;1/2/2020;;Rita;Dossou;Tante;01 66 77 88 99");

  it("une famille déjà enregistrée (brouillon compris) est écartée, sauf si elle est cochée", async () => {
    const kpade = await existante(dbA);
    const apercu = await analyserImport(dbA, memeTelephone);
    expect(apercu.familles[0]!.doublons).toEqual([
      {
        message: "Même téléphone de tuteur que la famille Kpadé (à compléter), déjà enregistrée.",
        familleId: kpade.id,
      },
    ]);
    await expect(
      importerFamilles(dbA, AUTEUR, memeTelephone, {
        empreinte: apercu.empreinte,
        corrections: [],
        doublons: [],
      }),
    ).rejects.toThrow(ImportRefuse);
    const rapport = await importerFamilles(dbA, AUTEUR, memeTelephone, {
      empreinte: apercu.empreinte,
      corrections: [],
      doublons: ["F1"],
    });
    expect(rapport.importees).toHaveLength(1);
    expect(await dbA.famille.count({ where: { finaliseeLe: null } })).toBe(2);
  });

  it("isolation : une famille de l'église B n'est jamais signalée dans l'église A", async () => {
    await existante(dbB);
    const apercu = await analyserImport(dbA, memeTelephone);
    expect(apercu.familles[0]!.doublons).toEqual([]);
    await importerFamilles(dbA, AUTEUR, memeTelephone, {
      empreinte: apercu.empreinte,
      corrections: [],
      doublons: [],
    });
    expect((await brouillonsDe(dbA)).map((f) => f.nom)).toEqual(["Dossou"]);
    expect((await brouillonsDe(dbB)).map((f) => f.nom)).toEqual(["Kpadé"]);
    // Row-Level Security: the drafts of A are invisible from B, even by a forced query.
    const nombre = await enEglise(proprietaire, b.egliseId, async () => {
      const { rows } = await proprietaire.query<{ n: string }>(
        `SELECT count(*) AS n FROM "Famille" WHERE nom = 'Dossou'`,
      );
      return Number(rows[0]!.n);
    });
    expect(nombre).toBe(0);
  });
});

describe("après l'import", () => {
  const importer = async () => {
    const octets = fichier("Houngbo;Délali;Houngbo;5/5/2018;F;Marc;Houngbo;Père;illisible");
    const apercu = await analyserImport(dbA, octets);
    const rapport = await importerFamilles(dbA, AUTEUR, octets, {
      empreinte: apercu.empreinte,
      corrections: [],
      doublons: [],
    });
    return rapport.importees[0]!.familleId;
  };

  it("la finalisation exige le téléphone du tuteur, puis attribue les matricules", async () => {
    const familleId = await importer();
    const fiche = (await lireFamille(dbA, familleId))!;
    const png = new Uint8Array(
      await sharp({ create: { width: 60, height: 60, channels: 3, background: "#7799aa" } })
        .png()
        .toBuffer(),
    );
    const dossier = await mkdtemp(join(tmpdir(), "hk-import-"));
    const saisie = (telephone: string) => ({
      nom: "Houngbo",
      notes: "",
      consentementDonnees: true,
      consentementPhotos: false,
      tuteurs: [
        {
          id: fiche.tuteurs[0]!.id,
          prenom: "Marc",
          nom: "Houngbo",
          lien: "Père",
          telephone,
          telephone2: "",
          whatsapp: "",
          principal: true,
          autorise: true,
          photo: { champ: "photo-marc" },
        },
      ],
      enfants: [
        {
          id: fiche.enfants[0]!.id,
          prenom: "Délali",
          nom: "Houngbo",
          dateNaissance: "2018-05-05",
          sexe: "F" as const,
          alertes: [],
          alerteDetail: "",
          notes: "",
          actif: true,
          photo: null,
        },
      ],
      autres: [],
    });
    const photos = new Map<string, FichierRecu>([
      ["photo-marc", { type: "image/png", octets: png }],
    ]);
    try {
      const stockage = creerStockageLocal(dossier);
      await expect(
        enregistrerFamille(dbA, AUTEUR, saisie(""), photos, stockage, familleId),
      ).rejects.toThrow("Saisissez le téléphone du tuteur.");
      await enregistrerFamille(dbA, AUTEUR, saisie("01 97 45 12 33"), photos, stockage, familleId);
    } finally {
      await rm(dossier, { recursive: true, force: true });
    }
    const finalisee = (await lireFamille(dbA, familleId))!;
    expect(finalisee.finaliseeLe).not.toBeNull();
    expect(finalisee.tuteurs[0]!.telephone).toBe("+2290197451233");
    expect(finalisee.enfants[0]!.matricule).toBe("HK-0002");
  });

  it("un brouillon importé est purgé après le délai de l'église", async () => {
    const familleId = await importer();
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `UPDATE "Famille" SET "createdAt" = "createdAt" - interval '91 days' WHERE id = $1`,
        [familleId],
      ),
    );
    expect(await purgerBrouillonsExpires(dbA, 90)).toBe(1);
    expect(await dbA.famille.findUnique({ where: { id: familleId } })).toBeNull();
  });
});

/**
 * Families (cahier §7.1, RG-01, RG-06, RG-11): registration, photos and consents, draft
 * finalisation, edition with deferred deletion of replaced photos, search, isolation A/B.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { analyserCle } from "@/lib/fichiers";
import { creerStockageLocal } from "@/lib/storage/local";
import type { Stockage } from "@/lib/storage";
import { clientEglise, type ClientEglise } from "@/lib/tenant";
import {
  FAMILLES_PAR_PAGE,
  FamilleRefusee,
  MESSAGE_CONTACT_SANS_NUMERO,
  creerBrouillon,
  enregistrerFamille,
  lireFamille,
  listerFamillesInscrites,
  rechercherFamilles,
  type FichierRecu,
} from "@/server/familles";
import { creerClientPlateforme } from "@/server/plateforme/db";
import { type Client, type Jeu, connecter, creerEglise, enEglise, viderBase } from "./support/db";
import { urlsDeTest } from "./support/urls";

let base: PrismaClient;
let proprietaire: Client;
let a: Jeu;
let b: Jeu;
let dbA: ClientEglise;
let dbB: ClientEglise;
let stockage: Stockage;
let dossier: string;
let png: FichierRecu;

const AUTEUR = { userId: "user_test", appareil: null };

beforeAll(async () => {
  base = creerClientPlateforme(urlsDeTest().app);
  proprietaire = await connecter("proprietaire");
  const octets = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: "#7799aa" },
  })
    .png()
    .toBuffer();
  png = { type: "image/png", octets: new Uint8Array(octets) };
});

afterAll(async () => {
  await base?.$disconnect();
  await proprietaire?.end();
});

beforeEach(async () => {
  if (dossier) await rm(dossier, { recursive: true, force: true });
  dossier = await mkdtemp(join(tmpdir(), "hk-familles-"));
  stockage = creerStockageLocal(dossier);
  await viderBase(proprietaire);
  a = await creerEglise(proprietaire, "a");
  b = await creerEglise(proprietaire, "b");
  // The fixture child already holds HK-0001.
  await proprietaire.query(`UPDATE "Eglise" SET "prochainMatricule" = 2`);
  dbA = clientEglise(base, a.egliseId);
  dbB = clientEglise(base, b.egliseId);
});

const enfant = (prenom: string, dateNaissance: string, photo: unknown = null) => ({
  prenom,
  nom: "Adjovi",
  dateNaissance,
  sexe: null,
  alertes: [],
  alerteDetail: "",
  notes: "",
  actif: true,
  photo,
});

const saisie = (champs: Record<string, unknown> = {}) => ({
  nom: "Adjovi",
  notes: "",
  consentementDonnees: true,
  consentementPhotos: false,
  tuteurs: [
    {
      prenom: "Mireille",
      nom: "Adjovi",
      lien: "Mère",
      telephone: "+229 01 97 45 12 33",
      telephone2: "",
      whatsapp: "",
      principal: true,
      autorise: true,
      photo: { champ: "photo-tuteur" },
    },
  ],
  enfants: [
    enfant("Ayo", "2019-03-14", { champ: "photo-ayo" }),
    enfant("Sèna", "2021-08-02"),
    enfant("Koffi", "2023-01-20"),
  ],
  autres: [],
  ...champs,
});

const photos = (...champs: string[]) => new Map(champs.map((c) => [c, png]));

async function fichiers() {
  const { readdir } = await import("node:fs/promises");
  try {
    return await readdir(join(dossier, "eglises", a.egliseId, "photos"));
  } catch {
    return [];
  }
}

describe("inscription", () => {
  it("inscrit une famille de 3 enfants : matricules par église, photos de l'adulte en WebP", async () => {
    const { familleId, enregistrement } = await enregistrerFamille(
      dbA,
      AUTEUR,
      saisie(),
      photos("photo-tuteur", "photo-ayo"),
      stockage,
    );
    expect(enregistrement).toBe("inscription");
    const fiche = (await lireFamille(dbA, familleId))!;
    expect(fiche.finaliseeLe).not.toBeNull();
    expect(fiche.enfants.map((e) => e.matricule).sort()).toEqual(["HK-0002", "HK-0003", "HK-0004"]);
    // Phones are stored in E.164 (church default country code +229).
    expect(fiche.tuteurs[0]!.telephone).toBe("+2290197451233");
    const adulte = fiche.tuteurs[0]!.autorise!;
    expect(analyserCle(adulte.photoKey!)).toEqual({ egliseId: a.egliseId, categorie: "photos" });
    const stockee = await stockage.get(adulte.photoKey!);
    const meta = await sharp(Buffer.from(stockee!.donnees)).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(600);
  });

  it("sans consentement photo, la photo d'un enfant n'est pas enregistrée", async () => {
    const { familleId } = await enregistrerFamille(
      dbA,
      AUTEUR,
      saisie({ consentementPhotos: false }),
      photos("photo-tuteur", "photo-ayo"),
      stockage,
    );
    const fiche = (await lireFamille(dbA, familleId))!;
    expect(fiche.enfants.every((e) => e.photoKey === null)).toBe(true);
    expect(fiche.consentementPhotos).toBeNull();
    // Only the adult's photo reached the storage.
    expect(await fichiers()).toHaveLength(1);
  });

  it("avec le consentement photo, la photo de l'enfant est enregistrée", async () => {
    const { familleId } = await enregistrerFamille(
      dbA,
      AUTEUR,
      saisie({ consentementPhotos: true }),
      photos("photo-tuteur", "photo-ayo"),
      stockage,
    );
    const fiche = (await lireFamille(dbA, familleId))!;
    expect(fiche.consentementPhotos).not.toBeNull();
    expect(fiche.enfants.find((e) => e.prenom === "Ayo")!.photoKey).toMatch(/\.webp$/);
    expect(await fichiers()).toHaveLength(2);
  });

  it("refuse une personne autorisée sans photo, sans rien écrire ni stocker", async () => {
    const sansPhoto = saisie();
    sansPhoto.tuteurs[0]!.photo = null as never;
    await expect(
      enregistrerFamille(dbA, AUTEUR, sansPhoto, photos("photo-ayo"), stockage),
    ).rejects.toThrow("Chaque personne autorisée à récupérer les enfants doit avoir une photo.");
    expect(await dbA.famille.count()).toBe(1); // the fixture family only
    expect(await fichiers()).toHaveLength(0);
  });

  it("refuse une inscription sans le consentement aux données", async () => {
    await expect(
      enregistrerFamille(
        dbA,
        AUTEUR,
        saisie({ consentementDonnees: false }),
        photos("photo-tuteur"),
        stockage,
      ),
    ).rejects.toThrow(ZodError);
  });

  it("refuse une date de naissance future et deux contacts principaux", async () => {
    await expect(
      enregistrerFamille(
        dbA,
        AUTEUR,
        saisie({ enfants: [enfant("Ayo", "2999-01-01")] }),
        photos("photo-tuteur"),
        stockage,
      ),
    ).rejects.toThrow(FamilleRefusee);
    const deux = saisie();
    deux.tuteurs.push({ ...deux.tuteurs[0]!, prenom: "Paul", photo: { champ: "photo-tuteur" } });
    await expect(
      enregistrerFamille(dbA, AUTEUR, deux, photos("photo-tuteur"), stockage),
    ).rejects.toThrow("Désignez un seul tuteur comme contact principal.");
  });
});

describe("familles inscrites", () => {
  /** Finalised families inserted directly in church A (as the owner, under its RLS). */
  const inscrire = (noms: string[]) =>
    enEglise(proprietaire, a.egliseId, async () => {
      for (const nom of noms) {
        await proprietaire.query(
          `INSERT INTO "Famille" (id, "egliseId", nom, "finaliseeLe", "updatedAt")
           VALUES ($1, $2, $3, now(), now())`,
          [`famille_${nom}`, a.egliseId, nom],
        );
      }
    });

  it("liste les familles finalisées par nom, avec enfants, contact principal et état de la carte", async () => {
    const { familleId } = await enregistrerFamille(
      dbA,
      AUTEUR,
      saisie(),
      photos("photo-tuteur"),
      stockage,
    );
    await dbA.$tx((tx) =>
      creerBrouillon(tx, AUTEUR, "229", {
        nom: "Brouillon",
        tuteurs: [],
        enfants: [{ prenom: "Ayo", nom: "Brouillon", dateNaissance: new Date("2020-02-02") }],
      }),
    );
    await inscrire(["Zinsou", "Bada"]);
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "CarteFamille" (id, "egliseId", "familleId", "tokenHash", "activeLe") VALUES
           ('carte_active', $1, $2, repeat('a', 64), now()),
           ('carte_attente', $1, 'famille_Zinsou', repeat('b', 64), NULL)`,
        [a.egliseId, familleId],
      ),
    );

    const liste = await listerFamillesInscrites(dbA, 1);
    // The draft is not listed; the fixture family ("Famille a") is.
    expect(liste.total).toBe(4);
    expect(liste.familles.map((f) => f.nom)).toEqual(["Adjovi", "Bada", "Famille a", "Zinsou"]);
    const adjovi = liste.familles[0]!;
    expect(adjovi.enfants.map((e) => e.prenom)).toEqual(["Ayo", "Sèna", "Koffi"]);
    expect(adjovi.enfants.every((e) => /^HK-\d{4}$/.test(e.matricule!))).toBe(true);
    expect(adjovi.contact).toEqual({
      prenom: "Mireille",
      nom: "Adjovi",
      telephone: "+2290197451233",
    });
    expect(liste.familles.map((f) => f.carte)).toEqual([
      "active",
      "aucune",
      "aucune",
      "en_attente",
    ]);
  });

  it("ordonne les enfants du plus âgé au plus jeune, dans la liste et sur la fiche", async () => {
    // Entered youngest first, with twins: the order comes from the birth dates.
    const { familleId } = await enregistrerFamille(
      dbA,
      AUTEUR,
      saisie({
        enfants: [
          enfant("Koffi", "2023-01-20"),
          enfant("Sèna", "2021-08-02"),
          enfant("Ayo", "2019-03-14"),
          enfant("Afi", "2021-08-02"),
        ],
      }),
      photos("photo-tuteur"),
      stockage,
    );
    const attendu = ["Ayo", "Afi", "Sèna", "Koffi"];
    const liste = await listerFamillesInscrites(dbA, 1);
    expect(liste.familles.find((f) => f.id === familleId)!.enfants.map((e) => e.prenom)).toEqual(
      attendu,
    );
    expect((await lireFamille(dbA, familleId))!.enfants.map((e) => e.prenom)).toEqual(attendu);
  });

  it("pagine par 25 et ramène une page hors limites à la plus proche", async () => {
    await inscrire(Array.from({ length: 30 }, (_, i) => `Famille ${String(i).padStart(2, "0")}`));
    const premiere = await listerFamillesInscrites(dbA, 1);
    expect(premiere).toMatchObject({ total: 31, page: 1, pages: 2 });
    expect(premiere.familles).toHaveLength(FAMILLES_PAR_PAGE);
    const seconde = await listerFamillesInscrites(dbA, 2);
    expect(seconde.familles).toHaveLength(6);
    expect(new Set([...premiere.familles, ...seconde.familles].map((f) => f.id)).size).toBe(31);
    expect((await listerFamillesInscrites(dbA, 99)).page).toBe(2);
    expect((await listerFamillesInscrites(dbA, Number.NaN)).page).toBe(1);
  });

  it("isolation A/B : chaque église ne liste que ses familles", async () => {
    await inscrire(["Hounkpè"]);
    const nomsB = (await listerFamillesInscrites(dbB, 1)).familles.map((f) => f.nom);
    expect(nomsB).toEqual(["Famille b"]);
    const nomsA = (await listerFamillesInscrites(dbA, 1)).familles.map((f) => f.nom);
    expect(nomsA).toEqual(["Famille a", "Hounkpè"]);
    expect((await listerFamillesInscrites(dbB, 1)).total).toBe(1);
  });
});

describe("brouillon et finalisation", () => {
  it("un brouillon n'a pas de matricule ; la finalisation en attribue et date le consentement", async () => {
    const brouillon = await dbA.$tx((tx) =>
      creerBrouillon(tx, AUTEUR, "229", {
        nom: "Houngbo",
        tuteurs: [
          {
            prenom: "Rita",
            nom: "Houngbo",
            lien: "Mère",
            telephone: "+229 01 02 03 04 05",
            principal: true,
          },
        ],
        enfants: [{ prenom: "Délali", nom: "Houngbo", dateNaissance: new Date("2020-02-02") }],
      }),
    );
    let fiche = (await lireFamille(dbA, brouillon.id))!;
    expect(fiche.finaliseeLe).toBeNull();
    expect(fiche.enfants[0]!.matricule).toBeNull();

    await enregistrerFamille(
      dbA,
      AUTEUR,
      {
        nom: "Houngbo",
        notes: "",
        consentementDonnees: true,
        consentementPhotos: false,
        tuteurs: [
          {
            id: fiche.tuteurs[0]!.id,
            prenom: "Rita",
            nom: "Houngbo",
            lien: "Mère",
            telephone: "+229 01 02 03 04 05",
            telephone2: "",
            whatsapp: "",
            principal: true,
            autorise: true,
            photo: { champ: "photo-rita" },
          },
        ],
        enfants: [{ ...enfant("Délali", "2020-02-02"), id: fiche.enfants[0]!.id, nom: "Houngbo" }],
        autres: [],
      },
      photos("photo-rita"),
      stockage,
      brouillon.id,
    );
    fiche = (await lireFamille(dbA, brouillon.id))!;
    expect(fiche.finaliseeLe).not.toBeNull();
    expect(fiche.consentementDonnees).not.toBeNull();
    expect(fiche.enfants[0]!.matricule).toBe("HK-0002");
  });
});

describe("modification", () => {
  it("une photo remplacée ou retirée est programmée pour une suppression différée, pas supprimée", async () => {
    const { familleId } = await enregistrerFamille(
      dbA,
      AUTEUR,
      saisie({ consentementPhotos: true }),
      photos("photo-tuteur", "photo-ayo"),
      stockage,
    );
    const avant = (await lireFamille(dbA, familleId))!;
    const ancienneAdulte = avant.tuteurs[0]!.autorise!.photoKey!;
    const ancienneAyo = avant.enfants.find((e) => e.prenom === "Ayo")!.photoKey!;

    // New adult photo, photo consent withdrawn (the child's photo goes).
    await enregistrerFamille(
      dbA,
      AUTEUR,
      saisie({
        consentementPhotos: false,
        tuteurs: [
          { ...saisie().tuteurs[0], id: avant.tuteurs[0]!.id, photo: { champ: "photo-nouvelle" } },
        ],
        enfants: avant.enfants.map((e) => ({
          ...enfant(e.prenom, e.dateNaissance.toISOString().slice(0, 10), { conserver: true }),
          id: e.id,
        })),
      }),
      photos("photo-nouvelle"),
      stockage,
      familleId,
    );
    const apres = (await lireFamille(dbA, familleId))!;
    expect(apres.tuteurs[0]!.autorise!.photoKey).not.toBe(ancienneAdulte);
    expect(apres.enfants.every((e) => e.photoKey === null)).toBe(true);
    // Matricules are kept.
    expect(apres.enfants.map((e) => e.matricule).sort()).toEqual(
      avant.enfants.map((e) => e.matricule).sort(),
    );

    // Due in 24 hours, measured on the database's clock (the one that set the date).
    const programmes = await dbA.$queryRaw<{ cle: string; dans24h: boolean }[]>`
      SELECT cle, "apresLe" > now() + interval '23 hours' AS dans24h FROM "FichierASupprimer"`;
    expect(programmes.map((p) => p.cle).sort()).toEqual([ancienneAdulte, ancienneAyo].sort());
    expect(programmes.every((p) => p.dans24h)).toBe(true);
    expect(await stockage.get(ancienneAdulte)).not.toBeNull();
  });
});

describe("téléphones", () => {
  it("refuse un numéro béninois à 8 chiffres et demande de confirmer 01, sans rien écrire", async () => {
    const ancien = saisie();
    ancien.tuteurs[0]!.telephone = "97 45 12 33";
    await expect(
      enregistrerFamille(dbA, AUTEUR, ancien, photos("photo-tuteur"), stockage),
    ).rejects.toThrow(
      "Tuteur 1, téléphone : Ce numéro a 8 chiffres. Voulez-vous dire 01 97 45 12 33 ?",
    );
    expect(await dbA.famille.count()).toBe(1);
  });

  it("la recherche par téléphone est limitée par index aux numéros de l'église active", async () => {
    // Under Row-Level Security the end of a number cannot be an index condition (ADR 0011):
    // the (egliseId, telephone) indexes restrict the scan to the active church.
    for (const table of ["Tuteur", "PersonneAutorisee"]) {
      const plan = await enEglise(proprietaire, a.egliseId, async () => {
        await proprietaire.query("SET LOCAL enable_seqscan = off");
        const { rows } = await proprietaire.query(
          `EXPLAIN SELECT "familleId" FROM "${table}" WHERE "telephone" LIKE '%' || '97451233'`,
        );
        return rows.map((r) => r["QUERY PLAN"]).join(" ");
      });
      expect(plan, table).toContain(`${table}_egliseId_telephone_idx`);
      expect(plan, table).toMatch(/Index Cond: \("egliseId" = /);
    }
  });
});

describe("recherche", () => {
  it("trouve par prénom d'enfant, nom de tuteur, téléphone ou matricule, dans l'église active seulement", async () => {
    await enregistrerFamille(dbA, AUTEUR, saisie(), photos("photo-tuteur"), stockage);
    const noms = async (terme: string, db = dbA) =>
      (await rechercherFamilles(db, terme)).map((f) => f.nom);
    expect(await noms("sèna")).toEqual(["Adjovi"]);
    expect(await noms("Mireille")).toEqual(["Adjovi"]);
    expect(await noms("97 45 12 33")).toEqual(["Adjovi"]);
    expect(await noms("hk2")).toEqual(["Adjovi"]);
    expect(await noms("HK-0002")).toEqual(["Adjovi"]);
    expect(await noms("x")).toEqual([]);
    // Church B finds nothing of church A.
    expect(await noms("Adjovi", dbB)).toEqual([]);
  });
});

describe("isolation A/B", () => {
  it("l'église A ne lit ni ne modifie une famille de B, même en envoyant ses identifiants", async () => {
    expect(await lireFamille(dbA, b.familleId)).toBeNull();
    await expect(
      enregistrerFamille(dbA, AUTEUR, saisie(), photos("photo-tuteur"), stockage, b.familleId),
    ).rejects.toThrow("Famille introuvable. Rechargez la page.");
    // An id of B's child slipped into a family of A is refused too.
    const { familleId } = await enregistrerFamille(
      dbA,
      AUTEUR,
      saisie(),
      photos("photo-tuteur"),
      stockage,
    );
    await expect(
      enregistrerFamille(
        dbA,
        AUTEUR,
        saisie({ enfants: [{ ...enfant("Intrus", "2020-01-01"), id: b.enfantId }] }),
        photos("photo-tuteur"),
        stockage,
        familleId,
      ),
    ).rejects.toThrow("Famille introuvable. Rechargez la page.");
    const nomB = await enEglise(proprietaire, b.egliseId, () =>
      proprietaire.query(`SELECT prenom FROM "Enfant" WHERE id = $1`, [b.enfantId]),
    );
    expect(nomB.rows).toEqual([{ prenom: "Prénom" }]);
  });
});

// A registered or finalised family always has a main contact with a valid number (urgency
// button, lot 3). Other guardians may have none, but any number typed must be valid.
describe("numéro des tuteurs d'une famille enregistrée", () => {
  const contact = saisie().tuteurs[0]!;
  const second = {
    ...contact,
    prenom: "Paul",
    lien: "Père",
    telephone: "",
    principal: false,
    autorise: false,
    photo: null,
  };
  const avecTuteurs = (...tuteurs: unknown[]) => saisie({ tuteurs });
  const inscrire = (donnees: unknown) =>
    enregistrerFamille(dbA, AUTEUR, donnees, photos("photo-tuteur"), stockage);

  /** Guardians' numbers of a family, read as the owner inside church A. */
  const numeros = (familleId: string) =>
    enEglise(proprietaire, a.egliseId, async () => {
      const { rows } = await proprietaire.query<{ telephone: string | null }>(
        `SELECT telephone FROM "Tuteur" WHERE "familleId" = $1 ORDER BY principal DESC`,
        [familleId],
      );
      return rows.map((r) => r.telephone);
    });

  it("l'inscription exige le numéro du contact principal, et refuse tout numéro invalide", async () => {
    await expect(inscrire(avecTuteurs({ ...contact, telephone: "" }))).rejects.toThrow(
      MESSAGE_CONTACT_SANS_NUMERO,
    );
    await expect(inscrire(avecTuteurs({ ...contact, telephone: "illisible" }))).rejects.toThrow(
      FamilleRefusee,
    );
    await expect(inscrire(avecTuteurs({ ...contact, telephone: "97451233" }))).rejects.toThrow(
      "Voulez-vous dire 01 97 45 12 33 ?",
    );
    // A second guardian without a number is accepted; with an invalid one, refused.
    await expect(
      inscrire(avecTuteurs(contact, { ...second, telephone: "illisible" })),
    ).rejects.toThrow("Tuteur 2, téléphone");
    await expect(
      inscrire(avecTuteurs(contact, { ...second, telephone: "97451233" })),
    ).rejects.toThrow("Voulez-vous dire 01 97 45 12 33 ?");
    // A main contact without a number, even with a second guardian who has one.
    await expect(
      inscrire(
        avecTuteurs({ ...contact, telephone: "" }, { ...second, telephone: "01 66 77 88 99" }),
      ),
    ).rejects.toThrow(MESSAGE_CONTACT_SANS_NUMERO);
    expect(await dbA.famille.count()).toBe(1); // the fixture family only

    const { familleId } = await inscrire(avecTuteurs(contact, second));
    expect(await numeros(familleId)).toEqual(["+2290197451233", null]);
  });

  it("la finalisation refuse un contact principal sans numéro, même absent de la demande", async () => {
    // Imported draft: the main contact has no number, the second guardian has one.
    const brouillon = await dbA.$tx((tx) =>
      creerBrouillon(tx, AUTEUR, "229", {
        nom: "Houngbo",
        tuteurs: [
          { prenom: "Rita", nom: "Houngbo", lien: "Mère", telephone: null, principal: true },
          {
            prenom: "Paul",
            nom: "Houngbo",
            lien: "Père",
            telephone: "0166778899",
            principal: false,
          },
        ],
        enfants: [{ prenom: "Délali", nom: "Houngbo", dateNaissance: new Date("2020-02-02") }],
      }),
    );
    const fiche = (await lireFamille(dbA, brouillon.id))!;
    const [rita, paul] = fiche.tuteurs;
    const finalisation = (tuteurs: unknown[]) =>
      enregistrerFamille(
        dbA,
        AUTEUR,
        saisie({
          nom: "Houngbo",
          tuteurs,
          enfants: [{ ...enfant("Délali", "2020-02-02"), id: fiche.enfants[0]!.id }],
        }),
        photos("photo-tuteur"),
        stockage,
        brouillon.id,
      );
    const tuteurRita = {
      ...contact,
      id: rita!.id,
      prenom: "Rita",
      nom: "Houngbo",
      telephone: "",
    };
    const tuteurPaul = {
      ...second,
      id: paul!.id,
      nom: "Houngbo",
      telephone: "01 66 77 88 99",
    };
    const resteBrouillon = async () => {
      const fiche = (await lireFamille(dbA, brouillon.id))!;
      expect(fiche.finaliseeLe).toBeNull();
      expect(fiche.enfants[0]!.matricule).toBeNull();
      expect(await numeros(brouillon.id)).toEqual([null, "+2290166778899"]);
    };

    await expect(finalisation([tuteurRita, tuteurPaul])).rejects.toThrow(
      MESSAGE_CONTACT_SANS_NUMERO,
    );
    await resteBrouillon();

    // Forged request: Rita left out, Paul made main contact. Her row is still the main
    // contact, without a number: two main contacts, refused.
    await expect(
      finalisation([
        { ...tuteurPaul, principal: true, autorise: true, photo: { champ: "photo-tuteur" } },
      ]),
    ).rejects.toThrow("Désignez un seul tuteur comme contact principal.");
    await resteBrouillon();

    // Paul becomes the main contact; Rita may stay without a number.
    await finalisation([
      { ...tuteurRita, principal: false, autorise: false, photo: null },
      { ...tuteurPaul, principal: true, autorise: true, photo: { champ: "photo-tuteur" } },
    ]);
    expect((await lireFamille(dbA, brouillon.id))!.finaliseeLe).not.toBeNull();
    expect(await numeros(brouillon.id)).toEqual(["+2290166778899", null]);
  });

  it("la modification ne retire pas le numéro du contact principal et ne désigne pas un tuteur sans numéro", async () => {
    const { familleId } = await inscrire(avecTuteurs(contact, second));
    const fiche = (await lireFamille(dbA, familleId))!;
    const [mireille, paul] = fiche.tuteurs;
    const modification = (telephones: [string, string], principal: 0 | 1 = 0) =>
      enregistrerFamille(
        dbA,
        AUTEUR,
        saisie({
          tuteurs: [
            {
              ...contact,
              id: mireille!.id,
              telephone: telephones[0],
              principal: principal === 0,
              photo: { conserver: true },
            },
            { ...second, id: paul!.id, telephone: telephones[1], principal: principal === 1 },
          ],
          enfants: fiche.enfants.map((e) => ({
            ...enfant(e.prenom, e.dateNaissance.toISOString().slice(0, 10)),
            id: e.id,
          })),
        }),
        photos(),
        stockage,
        familleId,
      );

    for (const telephone of ["", "   "]) {
      await expect(modification([telephone, ""])).rejects.toThrow(MESSAGE_CONTACT_SANS_NUMERO);
    }
    for (const telephone of ["illisible", "97451233"]) {
      await expect(modification([telephone, ""]), telephone).rejects.toThrow(FamilleRefusee);
      await expect(modification(["01 97 45 12 33", telephone]), telephone).rejects.toThrow(
        FamilleRefusee,
      );
    }
    // Paul, without a number, cannot become the main contact.
    await expect(modification(["01 97 45 12 33", ""], 1)).rejects.toThrow(
      MESSAGE_CONTACT_SANS_NUMERO,
    );
    expect(await numeros(familleId)).toEqual(["+2290197451233", null]);

    await modification(["01 97 45 12 33", "01 66 77 88 99"], 1);
    expect(await numeros(familleId)).toEqual(["+2290166778899", "+2290197451233"]);
  });
});

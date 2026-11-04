/**
 * Application barrier (ADR 0002), generated from the Prisma schema: for every compound
 * unique key that contains egliseId, on every church table, a request from church A that
 * names church B through that key is refused, whatever the operation. Read from the DMMF
 * (@prisma/internals), so a key added later is covered without touching this file.
 */
import { readFile } from "node:fs/promises";
import { getDMMF } from "@prisma/internals";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { MODELES_EGLISE, RequeteHorsEglise, clientEglise, type ClientEglise } from "@/lib/tenant";
import { creerClientPlateforme } from "@/server/plateforme/db";
import { type Client, type Jeu, connecter, creerEglise, enEglise, viderBase } from "./support/db";
import { urlsDeTest } from "./support/urls";

const { datamodel } = await getDMMF({
  datamodel: await readFile("prisma/schema.prisma", "utf8"),
});

type CleComposee = {
  modele: string;
  nom: string;
  champs: string[];
  valeurs: Record<string, unknown>;
};

/** Placeholder values by scalar type; only egliseId matters (it names church B). */
function valeurFactice(type: string): unknown {
  switch (type) {
    case "Int":
      return 1;
    case "DateTime":
      return new Date("2026-01-01T00:00:00Z");
    case "Boolean":
      return true;
    case "String":
      return "valeur";
    default: {
      const enumeration = datamodel.enums.find((e) => e.name === type);
      if (enumeration) return enumeration.values[0]!.name;
      throw new Error(`Type non prévu : ${type}`);
    }
  }
}

const CLES: CleComposee[] = datamodel.models
  .filter((m) => (MODELES_EGLISE as readonly string[]).includes(m.name))
  .flatMap((modele) =>
    [...(modele.primaryKey ? [modele.primaryKey] : []), ...modele.uniqueIndexes]
      .filter((u) => u.fields.length > 1 && u.fields.includes("egliseId"))
      .map((u) => ({
        modele: modele.name,
        nom: u.name ?? u.fields.join("_"),
        champs: [...u.fields],
        valeurs: Object.fromEntries(
          u.fields.map((champ) => [
            champ,
            champ === "egliseId"
              ? "__B__"
              : valeurFactice(modele.fields.find((f) => f.name === champ)!.type),
          ]),
        ),
      })),
  );

let base: PrismaClient;
let proprietaire: Client;
let a: Jeu;
let b: Jeu;
let dbA: ClientEglise;

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
  dbA = clientEglise(base, a.egliseId);
});

const delegue = (modele: string) =>
  (dbA as unknown as Record<string, Record<string, (args: unknown) => Promise<unknown>>>)[
    modele[0]!.toLowerCase() + modele.slice(1)
  ]!;

const cleVersB = (cle: CleComposee) => ({
  [cle.nom]: Object.fromEntries(
    Object.entries(cle.valeurs).map(([k, v]) => [k, v === "__B__" ? b.egliseId : v]),
  ),
});

describe("clés uniques composées contenant egliseId (lues dans le DMMF)", () => {
  it("le schéma en contient sur chaque table d'église concernée", () => {
    // Every church table has @@unique([id, egliseId]); Parametre has @@id([egliseId, cle]).
    const modeles = new Set(CLES.map((c) => c.modele));
    for (const modele of MODELES_EGLISE) {
      if (
        ![
          "EvenementPresence",
          "Appel",
          "AppelTelephonique",
          "Incident",
          "AuditLog",
          "AffectationMoniteur",
        ].includes(modele)
      ) {
        expect(modeles.has(modele), modele).toBe(true);
      }
    }
    expect(CLES.map((c) => `${c.modele}.${c.nom}`)).toEqual(
      expect.arrayContaining([
        "Parametre.egliseId_cle",
        "Enfant.egliseId_matricule",
        "Enfant.id_familleId_egliseId",
        "Session.egliseId_culteId_date",
        "PersonneAutorisee.tuteurId_egliseId",
        "Presence.basculeVers_egliseId",
      ]),
    );
  });

  describe.each(CLES.map((c) => [`${c.modele}.${c.nom}`, c] as const))("%s", (_nom, cle) => {
    it("findUnique, update, upsert et delete qui nomment B sont refusés", async () => {
      const operations = {
        findUnique: { where: cleVersB(cle) },
        update: { where: cleVersB(cle), data: {} },
        upsert: { where: cleVersB(cle), create: {}, update: {} },
        delete: { where: cleVersB(cle) },
      };
      for (const [operation, args] of Object.entries(operations)) {
        await expect(delegue(cle.modele)[operation]!(args), operation).rejects.toThrow(
          RequeteHorsEglise,
        );
      }
    });
  });
});

describe("relations vers une ligne de B", () => {
  const enfant = (famille: unknown) => ({
    data: {
      id: "enfant_force",
      prenom: "Prénom",
      nom: "Nom",
      dateNaissance: new Date("2021-01-01"),
      famille,
    },
  });

  it("connect vers une famille de B par sa clé composée est refusé", async () => {
    await expect(
      dbA.enfant.create(
        enfant({ connect: { id_egliseId: { id: b.familleId, egliseId: b.egliseId } } }) as never,
      ),
    ).rejects.toThrow(RequeteHorsEglise);
  });

  it("connect vers une famille de B par son seul id échoue sans rien écrire", async () => {
    await expect(
      dbA.enfant.create(enfant({ connect: { id: b.familleId } }) as never),
    ).rejects.toThrow();
    const lignes = await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(`SELECT id FROM "Enfant" WHERE id = 'enfant_force'`),
    );
    expect(lignes.rows).toEqual([]);
  });

  it("une écriture imbriquée qui crée une ligne dans B est refusée", async () => {
    await expect(
      dbA.famille.update({
        where: { id: a.familleId },
        data: {
          enfants: {
            create: {
              egliseId: b.egliseId,
              prenom: "Prénom",
              nom: "Nom",
              dateNaissance: new Date("2021-01-01"),
            },
          },
        },
      } as never),
    ).rejects.toThrow(RequeteHorsEglise);
  });

  it("un filtre imbriqué sur une relation qui nomme B est refusé", async () => {
    await expect(
      dbA.enfant.findMany({ where: { famille: { is: { egliseId: b.egliseId } } } } as never),
    ).rejects.toThrow(RequeteHorsEglise);
    const enfantsDeB = await enEglise(proprietaire, b.egliseId, () =>
      proprietaire.query(`SELECT count(*)::int AS n FROM "Enfant"`),
    );
    expect(enfantsDeB.rows[0].n).toBe(1);
  });
});

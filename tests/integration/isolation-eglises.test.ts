/**
 * Church A / church B isolation through the application layer (getTenantDb).
 * Mandatory test (cahier §16): a user of church A can neither read, modify nor
 * guess the existence of church B's data, even with a forced request.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  AccesRefuse,
  MODELES_EGLISE,
  RequeteHorsEglise,
  attribuerMatricule,
  clientEglise,
  verifierContexte,
  type ClientEglise,
} from "@/lib/tenant";
import { creerClientPlateforme } from "@/server/plateforme/db";
import { type Client, type Jeu, connecter, creerEglise, enEglise, viderBase } from "./support/db";
import { urlsDeTest } from "./support/urls";

let base: PrismaClient;
let proprietaire: Client;
let a: Jeu;
let b: Jeu;
let dbA: ClientEglise;

const ENFANTS_A = 3;
const ENFANTS_B = 2;

async function ajouterEnfants(jeu: Jeu, nombre: number) {
  await enEglise(proprietaire, jeu.egliseId, async () => {
    for (let i = 2; i <= nombre; i++) {
      await proprietaire.query(
        `INSERT INTO "Enfant" (id, "egliseId", matricule, "familleId", prenom, nom, "dateNaissance", "updatedAt")
         VALUES ($1, $2, $3, $4, 'Prénom', 'Nom', '2020-01-01', now())`,
        [`${jeu.enfantId}_${i}`, jeu.egliseId, `HK-000${i}`, jeu.familleId],
      );
    }
  });
}

async function creerCompte(id: string, eglises: { egliseId: string; actif?: boolean }[]) {
  await proprietaire.query(
    `INSERT INTO "User" (id, name, email, "updatedAt") VALUES ($1, $1, $2, now())`,
    [id, `${id}@harvest-kids.test`],
  );
  for (const { egliseId, actif = true } of eglises) {
    await proprietaire.query(
      `INSERT INTO "Membre" (id, "egliseId", "userId", roles, actif, "updatedAt")
       VALUES ($1, $2, $3, '{ACCUEIL}', $4, now())`,
      [`membre_${id}_${egliseId}`, egliseId, id, actif],
    );
  }
}

/** Reads a row of church B with the owner role, inside church B (proof it was not touched). */
async function lireDansB(sql: string, params: unknown[]) {
  return enEglise(
    proprietaire,
    b.egliseId,
    async () => (await proprietaire.query(sql, params)).rows,
  );
}

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
  await ajouterEnfants(a, ENFANTS_A);
  await ajouterEnfants(b, ENFANTS_B);
  dbA = clientEglise(base, a.egliseId);
});

describe("lecture", () => {
  it("un utilisateur de A ne voit que les enfants de A", async () => {
    const enfants = await dbA.enfant.findMany();
    expect(enfants).toHaveLength(ENFANTS_A);
    expect(new Set(enfants.map((e) => e.egliseId))).toEqual(new Set([a.egliseId]));
    expect(await dbA.enfant.count()).toBe(ENFANTS_A);
  });

  it("une lecture par identifiant d'un enfant de B renvoie null, comme un identifiant inexistant", async () => {
    expect(await dbA.enfant.findUnique({ where: { id: b.enfantId } })).toBeNull();
    expect(await dbA.enfant.findUnique({ where: { id: "inexistant" } })).toBeNull();
    expect(await dbA.enfant.findFirst({ where: { nom: "Nom b" } })).toBeNull();
  });

  it("une relation incluse ne traverse pas vers B", async () => {
    const famille = await dbA.famille.findUnique({
      where: { id: a.familleId },
      include: { enfants: true },
    });
    expect(famille?.enfants).toHaveLength(ENFANTS_A);
    expect(famille?.enfants.every((e) => e.egliseId === a.egliseId)).toBe(true);
  });

  it("requête forcée : filtrer explicitement sur l'église B est refusé", async () => {
    await expect(dbA.enfant.findMany({ where: { egliseId: b.egliseId } })).rejects.toBeInstanceOf(
      RequeteHorsEglise,
    );
  });

  it("requête forcée en SQL brut : la RLS seule bloque l'accès à B", async () => {
    const forcees = await dbA.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Enfant" WHERE "egliseId" = ${b.egliseId}`;
    expect(forcees).toEqual([]);
    const toutes = await dbA.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "Enfant"`;
    expect(toutes[0]?.n).toBe(ENFANTS_A);
  });
});

describe("écriture", () => {
  it("modifier ou supprimer un enfant de B échoue comme pour un enfant inexistant, et B reste intact", async () => {
    const modifB = dbA.enfant.update({ where: { id: b.enfantId }, data: { prenom: "Piraté" } });
    const modifInexistant = dbA.enfant.update({
      where: { id: "inexistant" },
      data: { prenom: "Piraté" },
    });
    await expect(modifB).rejects.toMatchObject({ code: "P2025" });
    await expect(modifInexistant).rejects.toMatchObject({ code: "P2025" });
    await expect(dbA.classe.delete({ where: { id: b.classeId } })).rejects.toMatchObject({
      code: "P2025",
    });

    expect(await lireDansB(`SELECT prenom FROM "Enfant" WHERE id = $1`, [b.enfantId])).toEqual([
      { prenom: "Prénom" },
    ]);
    expect(await lireDansB(`SELECT id FROM "Classe" WHERE id = $1`, [b.classeId])).toHaveLength(1);
  });

  it("une modification en masse sans filtre ne touche que A", async () => {
    const { count } = await dbA.enfant.updateMany({ data: { notes: "vu par A" } });
    expect(count).toBe(ENFANTS_A);
    expect(
      await lireDansB(`SELECT count(*)::int AS n FROM "Enfant" WHERE notes IS NOT NULL`, []),
    ).toEqual([{ n: 0 }]);
  });

  it("créer une ligne pour B est refusé ; sans église précisée, la ligne va dans A", async () => {
    await expect(
      dbA.famille.create({ data: { egliseId: b.egliseId, nom: "Intrus" } }),
    ).rejects.toBeInstanceOf(RequeteHorsEglise);

    // egliseId is injected by the scoped client: the input type does not require it.
    const famille = await dbA.famille.create({
      data: { nom: "Nouvelle" } as Parameters<typeof dbA.famille.create>[0]["data"],
    });
    expect(famille.egliseId).toBe(a.egliseId);
  });

  it("déplacer une ligne de A vers B est refusé", async () => {
    await expect(
      dbA.famille.update({ where: { id: a.familleId }, data: { egliseId: b.egliseId } }),
    ).rejects.toBeInstanceOf(RequeteHorsEglise);
  });

  it("rattacher un enfant de A à une famille de B est refusé par la clé composite", async () => {
    await expect(
      dbA.enfant.create({
        data: {
          matricule: "HK-0099",
          familleId: b.familleId,
          prenom: "X",
          nom: "Y",
          dateNaissance: new Date("2020-01-01"),
        } as Parameters<typeof dbA.enfant.create>[0]["data"],
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("tables de plateforme", () => {
  it("le client d'église n'expose ni comptes, ni membres, ni églises", () => {
    const brut = dbA as unknown as Record<string, unknown>;
    for (const table of ["user", "membre", "eglise", "authSession", "$transaction"]) {
      expect(() => brut[table], table).toThrow(RequeteHorsEglise);
    }
  });

  it("chaque modèle du client d'église correspond à une table sous RLS", async () => {
    const lignes = await enEglise(proprietaire, a.egliseId, async () =>
      (
        await proprietaire.query<{ relname: string }>(
          `SELECT relname FROM pg_class WHERE relrowsecurity AND relforcerowsecurity ORDER BY relname`,
        )
      ).rows.map((r) => r.relname),
    );
    expect([...MODELES_EGLISE].sort()).toEqual(lignes);
  });

  it("le client brut sans église active ne lit aucune ligne d'église", async () => {
    expect(await base.enfant.count()).toBe(0);
    expect(await base.famille.findMany()).toEqual([]);
  });
});

describe("transactions et matricules", () => {
  it("$tx enchaîne plusieurs opérations dans l'église active", async () => {
    const resultat = await dbA.$tx(async (tx) => {
      const famille = await tx.famille.create({
        data: { nom: "Transaction" } as Parameters<typeof tx.famille.create>[0]["data"],
      });
      const total = await tx.famille.count();
      return { famille, total };
    });
    expect(resultat.famille.egliseId).toBe(a.egliseId);
    expect(resultat.total).toBe(2);
  });

  it("une erreur annule toute la transaction", async () => {
    await expect(
      dbA.$tx(async (tx) => {
        await tx.famille.create({
          data: { nom: "Annulée" } as Parameters<typeof tx.famille.create>[0]["data"],
        });
        throw new Error("échec volontaire");
      }),
    ).rejects.toThrow("échec volontaire");
    expect(await dbA.famille.count({ where: { nom: "Annulée" } })).toBe(0);
  });

  it("RG-01 : matricules séquentiels par église, sans doublon sous concurrence", async () => {
    const matricules = await Promise.all(
      Array.from({ length: 20 }, () => dbA.$tx((tx) => attribuerMatricule(tx))),
    );
    expect(new Set(matricules).size).toBe(20);
    expect([...matricules].sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => `HK-${String(i + 1).padStart(4, "0")}`),
    );
    // Church B has its own counter.
    const dbB = clientEglise(base, b.egliseId);
    expect(await dbB.$tx((tx) => attribuerMatricule(tx))).toBe("HK-0001");
  });
});

describe("église active de la session", () => {
  beforeEach(async () => {
    await creerCompte("ua", [{ egliseId: a.egliseId }]);
    await creerCompte("uab", [{ egliseId: a.egliseId }, { egliseId: b.egliseId }]);
    await creerCompte("ub_inactif", [{ egliseId: b.egliseId, actif: false }]);
  });

  const session = (userId: string, egliseActiveId: string | null) => ({
    sessionId: `s_${userId}`,
    userId,
    egliseActiveId,
  });

  it("accepte l'église dont l'utilisateur est membre et renvoie ses rôles", async () => {
    await expect(verifierContexte(base, session("ua", a.egliseId))).resolves.toMatchObject({
      egliseId: a.egliseId,
      userId: "ua",
      roles: ["ACCUEIL"],
    });
  });

  it("session falsifiée : un membre de A seulement ne peut pas entrer dans B", async () => {
    await expect(verifierContexte(base, session("ua", b.egliseId))).rejects.toMatchObject({
      raison: "non_membre",
    });
  });

  it("un membre des deux églises peut entrer dans l'une ou l'autre", async () => {
    await expect(verifierContexte(base, session("uab", b.egliseId))).resolves.toMatchObject({
      egliseId: b.egliseId,
    });
  });

  it("refuse sans session, sans église choisie, avec un rattachement inactif, un compte désactivé ou une église suspendue", async () => {
    const refus = (s: Parameters<typeof verifierContexte>[1]) =>
      verifierContexte(base, s).then(
        () => "accepté",
        (e: unknown) => (e instanceof AccesRefuse ? e.raison : String(e)),
      );
    expect(await refus(null)).toBe("non_authentifie");
    expect(await refus(session("ua", null))).toBe("aucune_eglise");
    expect(await refus(session("ub_inactif", b.egliseId))).toBe("non_membre");

    await proprietaire.query(`UPDATE "User" SET actif = false WHERE id = 'ua'`);
    expect(await refus(session("ua", a.egliseId))).toBe("compte_inactif");

    await proprietaire.query(`UPDATE "Eglise" SET statut = 'SUSPENDUE' WHERE id = $1`, [
      b.egliseId,
    ]);
    expect(await refus(session("uab", b.egliseId))).toBe("eglise_suspendue");
  });
});

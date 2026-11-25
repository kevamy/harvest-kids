/**
 * Lot 3, step 5: call screen (cahier §7.8, ADR 0018; decisions and additions of 2026-11-24).
 * EcranAppareil is a platform table, outside RLS: these tests prove the isolation the
 * service gives it. An ADMIN of A neither lists, nor revokes, nor creates a screen of B; a
 * device of A never reaches B's data. The pairing link is consumed by one UPDATE … RETURNING:
 * two pairings at the same time with the same link, only one succeeds. The last view is
 * written at most once a minute. Time passes by moving the stored dates back.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { FORMAT_JETON_ECRAN, FORMAT_SECRET_APPAREIL, empreinteJeton } from "@/lib/jetons";
import { creerClientPlateforme } from "@/server/plateforme/db";
import {
  LIEN_INVALIDE,
  appairerEcran,
  creerEcran,
  ecranDeLAppareil,
  listerEcrans,
  revoquerEcran,
  tuilesEcran,
} from "@/server/plateforme/ecran";
import { type Client, type Jeu, connecter, creerEglise, enEglise, viderBase } from "./support/db";
import { urlsDeTest } from "./support/urls";

let base: PrismaClient;
let proprietaire: Client;
let a: Jeu;
let b: Jeu;

const admin = (jeu: Jeu) => ({
  egliseId: jeu.egliseId,
  userId: `admin_${jeu.egliseId}`,
  appareil: null,
});
const IP = "203.0.113.7";
const ORIGINE = "https://harvest-kids.test/";

/** A screen of the church and the token of its pairing link. */
async function ecran(jeu: Jeu, nom = "Salle principale") {
  const { id, jeton, lien } = await creerEcran(base, admin(jeu), nom, ORIGINE);
  return { id, jeton, lien };
}

/** A screen of the church, paired: its device secret. */
async function appaire(jeu: Jeu) {
  const { id, jeton } = await ecran(jeu);
  const resultat = await appairerEcran(base, slug(jeu), jeton, IP);
  if (!resultat.ok) throw new Error(resultat.message);
  return { id, secret: resultat.secret };
}

const slug = (jeu: Jeu) => `eglise-${jeu.egliseId.slice("eglise_".length)}`;

async function ligne(id: string) {
  const { rows } = await proprietaire.query(
    `SELECT "egliseId", "appaireLe" IS NOT NULL AS appaire, "appareilHash", "derniereVue",
            "revoqueLe" IS NOT NULL AS revoque, "revoquePar"
     FROM "EcranAppareil" WHERE id = $1`,
    [id],
  );
  return rows[0];
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
});

describe("administration des écrans (ADMIN de l'église active)", () => {
  it("crée un écran avec un lien d'appairage valable 24 h, stocké en empreinte seulement", async () => {
    const { id, jeton, lien } = await ecran(a);
    expect(jeton).toMatch(FORMAT_JETON_ECRAN);
    expect(lien).toBe(`https://harvest-kids.test/ecran/eglise-a#${jeton}`);
    const { rows } = await proprietaire.query(
      `SELECT "jetonHash", extract(epoch FROM "jetonExpireLe" - "creeLe")::int AS secondes
       FROM "EcranAppareil" WHERE id = $1`,
      [id],
    );
    expect(rows).toEqual([{ jetonHash: empreinteJeton(jeton), secondes: 24 * 60 * 60 }]);
    // The clear token is stored nowhere.
    const { rows: tout } = await proprietaire.query(`SELECT * FROM "EcranAppareil"`);
    expect(JSON.stringify(tout)).not.toContain(jeton);
    expect(await listerEcrans(base, admin(a))).toEqual([
      expect.objectContaining({ id, nom: "Salle principale", etat: "en_attente", appaireLe: null }),
    ]);
    await expect(creerEcran(base, admin(a), " ", ORIGINE)).rejects.toThrow("Donnez un nom");
  });

  it("isolation : un ADMIN de A ne liste, ne révoque ni ne crée un écran de B", async () => {
    const ecranB = await ecran(b, "Salle de B");
    // Listing: A sees only its own screens.
    const ecranA = await ecran(a);
    expect((await listerEcrans(base, admin(a))).map((e) => e.id)).toEqual([ecranA.id]);
    // Revoking B's screen from A: refused like a missing one, nothing written.
    expect(await revoquerEcran(base, admin(a), ecranB.id)).toBe(false);
    expect(await ligne(ecranB.id)).toMatchObject({ revoque: false, revoquePar: null });
    // Creating: the church is always the admin's own (no church in the input).
    expect(await ligne(ecranA.id)).toMatchObject({ egliseId: a.egliseId });
    expect((await listerEcrans(base, admin(b))).map((e) => e.id)).toEqual([ecranB.id]);
  });

  it("révoque un écran une seule fois, avec l'audit de plateforme", async () => {
    const { id } = await ecran(a);
    expect(await revoquerEcran(base, admin(a), id)).toBe(true);
    expect(await revoquerEcran(base, admin(a), id)).toBe(false);
    expect(await ligne(id)).toMatchObject({ revoque: true, revoquePar: `admin_${a.egliseId}` });
    expect((await listerEcrans(base, admin(a)))[0]).toMatchObject({ etat: "revoque" });
    const { rows } = await proprietaire.query(
      `SELECT action FROM "AuditPlateforme" WHERE "egliseId" = $1 ORDER BY "createdAt", id`,
      [a.egliseId],
    );
    expect(rows.map((r) => r.action)).toEqual(["ecran.creer", "ecran.revoquer"]);
  });
});

describe("appairage par le lien", () => {
  it("échange le lien contre le secret de l'appareil, une seule fois", async () => {
    const { id, jeton } = await ecran(a);
    const premier = await appairerEcran(base, slug(a), jeton, IP);
    expect(premier).toMatchObject({ ok: true, nom: "Salle principale" });
    if (!premier.ok) return;
    expect(premier.secret).toMatch(FORMAT_SECRET_APPAREIL);
    expect(await ligne(id)).toMatchObject({
      appaire: true,
      appareilHash: empreinteJeton(premier.secret),
    });
    expect(await appairerEcran(base, slug(a), jeton, IP)).toEqual({
      ok: false,
      message: LIEN_INVALIDE,
    });
  });

  it("deux appairages simultanés avec le même lien : un seul réussit", async () => {
    const { id, jeton } = await ecran(a);
    const resultats = await Promise.all(
      Array.from({ length: 2 }, () => appairerEcran(base, slug(a), jeton, IP)),
    );
    const reussis = resultats.filter((r) => r.ok);
    expect(reussis).toHaveLength(1);
    expect(resultats.filter((r) => !r.ok)).toEqual([{ ok: false, message: LIEN_INVALIDE }]);
    // The device kept is the one that succeeded.
    const secret = (reussis[0] as { secret: string }).secret;
    expect(await ligne(id)).toMatchObject({ appareilHash: empreinteJeton(secret) });
  });

  it("refuse un lien expiré, révoqué, d'une autre église, d'une église suspendue, ou mal formé", async () => {
    const expire = await ecran(a, "Expiré");
    await proprietaire.query(
      `UPDATE "EcranAppareil" SET "jetonExpireLe" = "jetonExpireLe" - interval '25 hours' WHERE id = $1`,
      [expire.id],
    );
    const revoque = await ecran(a, "Révoqué");
    await revoquerEcran(base, admin(a), revoque.id);
    const autre = await ecran(a, "Adresse de B");
    for (const [slugEssai, jeton] of [
      [slug(a), expire.jeton],
      [slug(a), revoque.jeton],
      // A's link on B's address: never pairs a device to the church of the address.
      [slug(b), autre.jeton],
      [slug(a), "HKE1.court"],
      [slug(a), ""],
    ] as const) {
      expect(await appairerEcran(base, slugEssai, jeton, IP)).toEqual({
        ok: false,
        message: LIEN_INVALIDE,
      });
    }
    await proprietaire.query(`UPDATE "Eglise" SET statut = 'SUSPENDUE' WHERE id = $1`, [
      a.egliseId,
    ]);
    expect(await appairerEcran(base, slug(a), autre.jeton, IP)).toMatchObject({ ok: false });
    expect(await ligne(autre.id)).toMatchObject({ appaire: false });
  });

  it("limite les essais : 10 par lien en 15 minutes", async () => {
    const { jeton } = await ecran(a);
    const faux = `${jeton.slice(0, -1)}${jeton.endsWith("A") ? "B" : "A"}`;
    for (let i = 0; i < 10; i++) {
      expect(await appairerEcran(base, slug(a), faux, `198.51.100.${i}`)).toMatchObject({
        ok: false,
        message: LIEN_INVALIDE,
      });
    }
    expect(await appairerEcran(base, slug(a), faux, "198.51.100.99")).toEqual({
      ok: false,
      message: expect.stringMatching(/^Trop de tentatives\. Réessayez dans \d+ minutes\.$/),
    });
  });
});

describe("appareil appairé", () => {
  it("reconnu sur l'adresse de son église seulement ; révoqué ou inconnu sinon", async () => {
    const { id, secret } = await appaire(a);
    expect(await ecranDeLAppareil(base, slug(a), secret)).toMatchObject({
      etat: "actif",
      ecranId: id,
      egliseId: a.egliseId,
    });
    // A device of A on B's address never reaches B (404 for the route).
    expect(await ecranDeLAppareil(base, slug(b), secret)).toEqual({ etat: "inconnu" });
    expect(await ecranDeLAppareil(base, slug(a), undefined)).toEqual({ etat: "inconnu" });
    expect(await ecranDeLAppareil(base, slug(a), `HKA1.${"x".repeat(43)}`)).toEqual({
      etat: "inconnu",
    });
    await revoquerEcran(base, admin(a), id);
    expect(await ecranDeLAppareil(base, slug(a), secret)).toEqual({ etat: "revoque" });
  });

  it("dernière vue écrite au plus une fois par minute", async () => {
    const { id, secret } = await appaire(a);
    const premiere = await ecranDeLAppareil(base, slug(a), secret);
    expect(premiere).toMatchObject({ renouveler: true });
    const vue = (await ligne(id))!.derniereVue as Date;
    expect(vue).toBeInstanceOf(Date);

    // Two reads 3 s apart (two refreshes): one write only.
    const seconde = await ecranDeLAppareil(base, slug(a), secret);
    expect(seconde).toMatchObject({ renouveler: false });
    expect((await ligne(id))!.derniereVue).toEqual(vue);

    // A minute later, the next read writes again.
    await proprietaire.query(
      `UPDATE "EcranAppareil" SET "derniereVue" = "derniereVue" - interval '61 seconds' WHERE id = $1`,
      [id],
    );
    expect(await ecranDeLAppareil(base, slug(a), secret)).toMatchObject({ renouveler: true });
    expect(((await ligne(id))!.derniereVue as Date).getTime()).toBeGreaterThan(
      vue.getTime() - 61_000,
    );
  });
});

describe("tuiles de l'écran", () => {
  /** Open session: one child at the infirmerie, one with a parent call, both in the church. */
  async function sessionAvecAppels(jeu: Jeu) {
    const sql = (requete: string, valeurs: unknown[]) =>
      enEglise(proprietaire, jeu.egliseId, () => proprietaire.query(requete, valeurs));
    await sql(`UPDATE "Session" SET statut = 'OUVERTE' WHERE id = $1 AND "egliseId" = $2`, [
      jeu.sessionId,
      jeu.egliseId,
    ]);
    await sql(
      `INSERT INTO "Enfant" (id, "egliseId", matricule, "familleId", prenom, nom, "dateNaissance", "updatedAt")
       VALUES ($1, $2, 'HK-0002', $3, 'Sèna', 'Secret', '2019-01-01', now())`,
      [`${jeu.enfantId}_2`, jeu.egliseId, jeu.familleId],
    );
    await sql(
      `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut, "codeRetrait", "checkinPar", "infirmerieLe")
       VALUES ($1, $2, $3, $4, $5, 'INFIRMERIE', 'K7RM', 'u', now()),
              ($6, $2, $3, $7, $5, 'EN_SALLE', 'K7RM', 'u', NULL)`,
      [
        `p1_${jeu.egliseId}`,
        jeu.egliseId,
        jeu.sessionId,
        jeu.enfantId,
        jeu.classeId,
        `p2_${jeu.egliseId}`,
        `${jeu.enfantId}_2`,
      ],
    );
    await sql(
      `INSERT INTO "Appel" (id, "egliseId", "presenceId", motif, lieu, "creePar")
       VALUES ($1, $2, $3, 'pleurs', 'Accueil enfants', 'u')`,
      [`appel_${jeu.egliseId}`, jeu.egliseId, `p2_${jeu.egliseId}`],
    );
  }

  it("matricule et lieu seulement : l'infirmerie d'abord, puis les appels ; rien d'une autre église", async () => {
    await sessionAvecAppels(a);
    const tuiles = await tuilesEcran(base, a.egliseId);
    expect(tuiles).toEqual([
      { matricule: "HK-0001", type: "infirmerie", lieu: "Infirmerie" },
      { matricule: "HK-0002", type: "appel", lieu: "Accueil enfants" },
    ]);
    // RG-10: no first name, no family name anywhere in the answer.
    expect(JSON.stringify(tuiles)).not.toMatch(/Prénom|Sèna|Secret|Nom a/);
    expect(await tuilesEcran(base, b.egliseId)).toEqual([]);
  });

  it("une session clôturée ne montre plus rien", async () => {
    await sessionAvecAppels(a);
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `UPDATE "Session" SET statut = 'CLOTUREE' WHERE id = $1 AND "egliseId" = $2`,
        [a.sessionId, a.egliseId],
      ),
    );
    expect(await tuilesEcran(base, a.egliseId)).toEqual([]);
  });
});

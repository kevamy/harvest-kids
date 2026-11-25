/**
 * Lot 3, step 4: parent call (cahier §7.5, ADR 0019). A call names a reason and one of the
 * church's meeting places; one open call per presence, even when two tablets call at the
 * same time; it ends when the parent arrives, when it is cancelled, or with the check-out (in
 * its transaction); each step writes an event and an audit entry. Church B never calls nor
 * sees a call of church A.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { clientEglise, type ClientEglise } from "@/lib/tenant";
import {
  AppelRefuse,
  appelOuvert,
  appelerParent,
  appelsEnCours,
  resoudreAppel,
} from "@/server/appels";
import { validerCheckout } from "@/server/checkout";
import { creerClientPlateforme } from "@/server/plateforme/db";
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

const auteur = contexteVerifie({ egliseId: "" } as Jeu);
const LIEUX = ["Accueil enfants", "Infirmerie"];

const sql = (jeu: Jeu, requete: string, valeurs: unknown[] = []) =>
  enEglise(proprietaire, jeu.egliseId, () => proprietaire.query(requete, valeurs));

/** Open session, Ayo present with code K7RM, his mother authorised. */
async function preparer(jeu: Jeu) {
  await sql(jeu, `UPDATE "Session" SET statut = 'OUVERTE' WHERE id = $1 AND "egliseId" = $2`, [
    jeu.sessionId,
    jeu.egliseId,
  ]);
  await sql(
    jeu,
    `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut, "codeRetrait", "checkinPar")
     VALUES ($1, $2, $3, $4, $5, 'PRESENT', 'K7RM', 'user_accueil')`,
    [`presence_${jeu.egliseId}`, jeu.egliseId, jeu.sessionId, jeu.enfantId, jeu.classeId],
  );
  await sql(
    jeu,
    `INSERT INTO "PersonneAutorisee" (id, "egliseId", "familleId", prenom, nom, lien, "photoKey")
     VALUES ($1, $2, $3, 'Afi', 'Mensah', 'Mère', 'eglises/x/photos/mere.webp')`,
    [`pa_${jeu.egliseId}`, jeu.egliseId, jeu.familleId],
  );
  return `presence_${jeu.egliseId}`;
}

const appeler = (
  db: ClientEglise,
  presenceId: string,
  lieu = "Accueil enfants",
  motif = "pleurs",
) => db.$tx((tx) => appelerParent(tx, auteur, { presenceId, motif, lieu }, LIEUX));

async function appelsDe(jeu: Jeu) {
  const { rows } = await sql(
    jeu,
    `SELECT motif, lieu, resolution, "resoluPar" FROM "Appel" WHERE "egliseId" = $1 ORDER BY "creeLe", id`,
    [jeu.egliseId],
  );
  return rows;
}

async function evenementsDe(jeu: Jeu, presenceId: string) {
  const { rows } = await sql(
    jeu,
    `SELECT type, detail - 'appelId' AS detail FROM "EvenementPresence"
     WHERE "egliseId" = $1 AND "presenceId" = $2 AND type LIKE 'appel%' ORDER BY "createdAt", id`,
    [jeu.egliseId, presenceId],
  );
  return rows;
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
  dbA = clientEglise(base, a.egliseId);
  dbB = clientEglise(base, b.egliseId);
});

describe("appel du parent", () => {
  it("appelle, refuse un second appel et un lieu hors liste, puis se termine « parent arrivé »", async () => {
    const presenceId = await preparer(a);
    await expect(appeler(dbA, presenceId, "Parking")).rejects.toThrow("plus proposé");
    await expect(appeler(dbA, presenceId, "Accueil enfants", "faim")).rejects.toThrow(
      "Choisissez le motif",
    );
    expect(await appeler(dbA, presenceId)).toEqual({ prenom: "Prénom" });
    await expect(appeler(dbA, presenceId, "Infirmerie", "soins")).rejects.toThrow("déjà appelé");
    expect(await appelOuvert(dbA, presenceId)).toMatchObject({
      motif: "pleurs",
      lieu: "Accueil enfants",
    });
    expect(await appelsEnCours(dbA)).toEqual([
      expect.objectContaining({ presenceId, matricule: "HK-0001", lieu: "Accueil enfants" }),
    ]);

    await dbA.$tx((tx) => resoudreAppel(tx, auteur, { presenceId, resolution: "parent_arrive" }));
    await expect(
      dbA.$tx((tx) => resoudreAppel(tx, auteur, { presenceId, resolution: "annule" })),
    ).rejects.toThrow("plus d'appel en cours");
    expect(await appelsEnCours(dbA)).toEqual([]);
    // Resolved: the parent can be called again.
    await appeler(dbA, presenceId, "Infirmerie", "soins");

    expect(await appelsDe(a)).toEqual([
      {
        motif: "pleurs",
        lieu: "Accueil enfants",
        resolution: "parent_arrive",
        resoluPar: "user_test",
      },
      { motif: "soins", lieu: "Infirmerie", resolution: null, resoluPar: null },
    ]);
    expect(await evenementsDe(a, presenceId)).toEqual([
      { type: "appel_parent", detail: { motif: "pleurs", lieu: "Accueil enfants" } },
      { type: "appel_parent_resolu", detail: { resolution: "parent_arrive" } },
      { type: "appel_parent", detail: { motif: "soins", lieu: "Infirmerie" } },
    ]);
    const { rows } = await sql(
      a,
      `SELECT action, count(*)::int AS n FROM "AuditLog"
       WHERE "egliseId" = $1 AND entite = 'Appel' GROUP BY action ORDER BY action`,
      [a.egliseId],
    );
    expect(rows).toEqual([
      { action: "appel.cree", n: 2 },
      { action: "appel.resolu", n: 1 },
    ]);
  });

  it("deux tablettes appellent en même temps : un seul appel", async () => {
    const presenceId = await preparer(a);
    const resultats = await Promise.allSettled([
      appeler(dbA, presenceId),
      appeler(dbA, presenceId, "Infirmerie", "soins"),
    ]);
    expect(resultats.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refus = resultats.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refus.reason).toBeInstanceOf(AppelRefuse);
    expect(await appelsDe(a)).toHaveLength(1);
  });

  it("le check-out termine l'appel « enfant récupéré », dans sa transaction", async () => {
    const presenceId = await preparer(a);
    await appeler(dbA, presenceId);
    await dbA.$tx((tx) =>
      validerCheckout(tx, auteur, async () => false, {
        sessionId: a.sessionId,
        familleId: a.familleId,
        code: "K7RM",
        personneAutoriseeId: `pa_${a.egliseId}`,
        presenceIds: [presenceId],
      }),
    );
    expect(await appelsDe(a)).toEqual([
      { motif: "pleurs", lieu: "Accueil enfants", resolution: "recupere", resoluPar: "user_test" },
    ]);
    expect(await appelsEnCours(dbA)).toEqual([]);
    // Collected: no new call.
    await expect(appeler(dbA, presenceId)).rejects.toThrow("plus dans une session ouverte");
  });

  it("une session clôturée n'a plus d'appel en cours affiché", async () => {
    const presenceId = await preparer(a);
    await appeler(dbA, presenceId);
    await sql(a, `UPDATE "Session" SET statut = 'CLOTUREE' WHERE id = $1 AND "egliseId" = $2`, [
      a.sessionId,
      a.egliseId,
    ]);
    expect(await appelsEnCours(dbA)).toEqual([]);
  });

  it("isolation A/B : B n'appelle, ne termine ni ne voit un appel de A", async () => {
    const presenceA = await preparer(a);
    await preparer(b);
    await expect(appeler(dbB, presenceA)).rejects.toThrow(AppelRefuse);
    await appeler(dbA, presenceA);
    await expect(
      dbB.$tx((tx) => resoudreAppel(tx, auteur, { presenceId: presenceA, resolution: "annule" })),
    ).rejects.toThrow(AppelRefuse);
    expect(await appelsEnCours(dbB)).toEqual([]);
    expect(await appelOuvert(dbB, presenceA)).toBeNull();
    expect(await appelsDe(a)).toEqual([
      { motif: "pleurs", lieu: "Accueil enfants", resolution: null, resoluPar: null },
    ]);
  });
});

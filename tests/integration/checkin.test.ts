/**
 * Lot 2, step 3: check-in (cahier §7.3, RG-04, RG-05, RG-08, RG-16, RG-17). The scan only
 * reads; validating activates a pending card, records the children PRESENT with one code per
 * family, an EvenementPresence and an audit entry each, in one transaction.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { clientEglise, type ClientEglise } from "@/lib/tenant";
import { CheckinRefuse, preparerCheckin, validerCheckin } from "@/server/checkin";
import { FORMAT_CODE_RETRAIT } from "@/server/checkin-regles";
import { creerClientPlateforme } from "@/server/plateforme/db";
import { ouvrirSession } from "@/server/sessions";
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

const auteur = contexteVerifie;
const aucunMoniteur = async () => false;
const jeton = (lettre: string) => `HKF1.${lettre.repeat(22)}`;
const empreinte = (valeur: string) => createHash("sha256").update(valeur, "utf8").digest("hex");

/** Runs SQL as the owner inside a church. */
const sql = (jeu: Jeu, requete: string, valeurs: unknown[] = []) =>
  enEglise(proprietaire, jeu.egliseId, () => proprietaire.query(requete, valeurs));

/** A finalised family with two children of the "3–5 ans" age on the session's date. */
async function famille(jeu: Jeu, cle: string, finalisee = true) {
  const familleId = `famille_${cle}`;
  await sql(
    jeu,
    `INSERT INTO "Famille" (id, "egliseId", nom, "finaliseeLe", "updatedAt")
     VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END, now())`,
    [familleId, jeu.egliseId, `Famille ${cle}`, finalisee],
  );
  const enfants = [`${familleId}_ayo`, `${familleId}_sena`];
  for (const [i, id] of enfants.entries()) {
    await sql(
      jeu,
      `INSERT INTO "Enfant" (id, "egliseId", matricule, "familleId", prenom, nom, "dateNaissance", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [
        id,
        jeu.egliseId,
        finalisee ? `HK-${cle}${i}` : null,
        familleId,
        i === 0 ? "Ayo" : "Sèna",
        cle,
        i === 0 ? "2021-05-02" : "2022-09-10",
      ],
    );
  }
  return { familleId, enfants };
}

/** A card of the family (pending unless active), known by its clear token. */
const carte = (
  jeu: Jeu,
  familleId: string,
  lettre: string,
  etat: { active?: boolean; enfantId?: string; revoquee?: boolean } = {},
) =>
  sql(
    jeu,
    `INSERT INTO "CarteFamille" (id, "egliseId", "familleId", "enfantId", "tokenHash", "activeLe", "revoqueeLe")
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() END, CASE WHEN $7 THEN now() END)`,
    [
      `carte_${lettre}`,
      jeu.egliseId,
      familleId,
      etat.enfantId ?? null,
      empreinte(jeton(lettre)),
      !!etat.active,
      !!etat.revoquee,
    ],
  );

const ouvrirClasse = (jeu: Jeu) =>
  sql(jeu, `UPDATE "SessionClasse" SET "ouverteLe" = now() WHERE "classeId" = $1`, [jeu.classeId]);

const valider = (saisie: Record<string, unknown>) =>
  dbA.$tx((tx) =>
    validerCheckin(tx, auteur(a), aucunMoniteur, { sessionId: a.sessionId, ...saisie }),
  );

const lignes = async (requete: string) => (await sql(a, requete)).rows;

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
  // The fixture session is on 2026-10-18; the fixture class covers 36 to 71 months.
  await dbA.$tx((tx) => ouvrirSession(tx, auteur(a), a.sessionId));
});

describe("préparation (lecture seule)", () => {
  it("une carte famille en attente ouvre tous les enfants, classe proposée, sans rien activer", async () => {
    const { familleId, enfants } = await famille(a, "f1");
    await carte(a, familleId, "A");
    await ouvrirClasse(a);

    const preparation = await preparerCheckin(dbA, aucunMoniteur, {
      sessionId: a.sessionId,
      jeton: jeton("A"),
    });
    expect(preparation.famille).toEqual({ id: familleId, nom: "Famille f1" });
    expect(preparation.carte).toEqual({ type: "famille", enAttente: true });
    expect(preparation.classes).toEqual([
      { id: a.classeId, nom: "3–5 ans", salle: null, ouverte: true },
    ]);
    // Born 2021-05-02 and 2022-09-10: 65 and 49 months on 2026-10-18, eldest first.
    expect(preparation.enfants.map((e) => [e.id, e.ageMois, e.coche, e.classe.proposee])).toEqual([
      [enfants[0], 65, true, a.classeId],
      [enfants[1], 49, true, a.classeId],
    ]);
    expect(await lignes(`SELECT "activeLe" FROM "CarteFamille"`)).toEqual([{ activeLe: null }]);
    expect(await lignes(`SELECT id FROM "AuditLog" WHERE action <> 'session.ouverte'`)).toEqual([]);
  });

  it("une carte enfant ne coche que son enfant (RG-16)", async () => {
    const { familleId, enfants } = await famille(a, "f1");
    await carte(a, familleId, "E", { active: true, enfantId: enfants[1] });
    const { enfants: affiches, carte: lue } = await preparerCheckin(dbA, aucunMoniteur, {
      sessionId: a.sessionId,
      jeton: jeton("E"),
    });
    expect(lue).toEqual({ type: "enfant", enAttente: false });
    expect(affiches.map((e) => e.coche)).toEqual([false, true]);
  });

  it("refuse une famille en brouillon, une carte remplacée et une session non ouverte", async () => {
    const { familleId } = await famille(a, "f1", false);
    await expect(
      preparerCheckin(dbA, aucunMoniteur, { sessionId: a.sessionId, familleId }),
    ).rejects.toMatchObject({ name: "CheckinRefuse", brouillonId: familleId });

    const finalisee = await famille(a, "f2");
    await carte(a, finalisee.familleId, "R", { revoquee: true });
    await expect(
      preparerCheckin(dbA, aucunMoniteur, { sessionId: a.sessionId, jeton: jeton("R") }),
    ).rejects.toThrow("Cette carte a été remplacée.");

    await sql(a, `UPDATE "Session" SET statut = 'PLANIFIEE'`);
    await expect(
      preparerCheckin(dbA, aucunMoniteur, {
        sessionId: a.sessionId,
        familleId: finalisee.familleId,
      }),
    ).rejects.toThrow("La session n'est pas ouverte");
  });

  it("isolation A/B : une carte ou une famille de B est refusée dans A (RG-14)", async () => {
    const deB = await famille(b, "fb");
    await carte(b, deB.familleId, "B", { active: true });
    await expect(
      preparerCheckin(dbA, aucunMoniteur, { sessionId: a.sessionId, jeton: jeton("B") }),
    ).rejects.toThrow("Cette carte n'appartient pas à cette église.");
    await expect(
      preparerCheckin(dbA, aucunMoniteur, { sessionId: a.sessionId, familleId: deB.familleId }),
    ).rejects.toThrow("Famille introuvable.");
    await expect(
      preparerCheckin(dbA, aucunMoniteur, { sessionId: b.sessionId, familleId: deB.familleId }),
    ).rejects.toThrow("Session introuvable.");
  });
});

describe("validation", () => {
  it("active la carte en attente, enregistre les enfants PRESENT avec un code, l'historique et l'audit", async () => {
    const { familleId, enfants } = await famille(a, "f1");
    await carte(a, familleId, "A");
    await ouvrirClasse(a);

    const resultat = await valider({
      familleId,
      jeton: jeton("A"),
      enfants: enfants.map((enfantId) => ({ enfantId, classeId: a.classeId })),
    });
    expect(resultat.codeRetrait).toMatch(FORMAT_CODE_RETRAIT);
    expect(resultat.enfants.map((e) => [e.prenom, e.matricule, e.classe])).toEqual([
      ["Ayo", "HK-f10", "3–5 ans"],
      ["Sèna", "HK-f11", "3–5 ans"],
    ]);

    expect(await lignes(`SELECT "activeLe" IS NOT NULL AS active FROM "CarteFamille"`)).toEqual([
      { active: true },
    ]);
    const presences = await lignes(
      `SELECT statut, "codeRetrait", "checkinPar" FROM "Presence" ORDER BY "enfantId"`,
    );
    expect(presences).toEqual([
      { statut: "PRESENT", codeRetrait: resultat.codeRetrait, checkinPar: "user_test" },
      { statut: "PRESENT", codeRetrait: resultat.codeRetrait, checkinPar: "user_test" },
    ]);
    expect(await lignes(`SELECT type FROM "EvenementPresence"`)).toEqual([
      { type: "checkin" },
      { type: "checkin" },
    ]);
    expect(
      (await lignes(`SELECT action FROM "AuditLog" ORDER BY "createdAt", id`)).map((l) => l.action),
    ).toEqual(["session.ouverte", "carte.activee", "presence.checkin", "presence.checkin"]);
  });

  it("refuse une classe non ouverte (RG-05) et une famille en brouillon, sans rien écrire", async () => {
    const { familleId, enfants } = await famille(a, "f1");
    await expect(
      valider({ familleId, enfants: [{ enfantId: enfants[0], classeId: a.classeId }] }),
    ).rejects.toThrow("La classe 3–5 ans n'est pas ouverte");

    await ouvrirClasse(a);
    const brouillon = await famille(a, "f2", false);
    await expect(
      valider({
        familleId: brouillon.familleId,
        enfants: [{ enfantId: brouillon.enfants[0], classeId: a.classeId }],
      }),
    ).rejects.toMatchObject({ name: "CheckinRefuse", brouillonId: brouillon.familleId });
    expect(await lignes(`SELECT id FROM "Presence"`)).toEqual([]);
  });

  it("un code par famille et par session (RG-04), un enfant une seule fois (RG-08)", async () => {
    await ouvrirClasse(a);
    const f1 = await famille(a, "f1");
    const f2 = await famille(a, "f2");
    const premier = await valider({
      familleId: f1.familleId,
      enfants: [{ enfantId: f1.enfants[0], classeId: a.classeId }],
    });
    // The sibling arriving later gets the family's code.
    const second = await valider({
      familleId: f1.familleId,
      enfants: [{ enfantId: f1.enfants[1], classeId: a.classeId }],
    });
    expect(second.codeRetrait).toBe(premier.codeRetrait);
    const autre = await valider({
      familleId: f2.familleId,
      enfants: [{ enfantId: f2.enfants[0], classeId: a.classeId }],
    });
    expect(autre.codeRetrait).not.toBe(premier.codeRetrait);

    await expect(
      valider({
        familleId: f1.familleId,
        enfants: [{ enfantId: f1.enfants[0], classeId: a.classeId }],
      }),
    ).rejects.toThrow("Ayo est déjà enregistré(e) dans cette session.");

    const preparation = await preparerCheckin(dbA, aucunMoniteur, {
      sessionId: a.sessionId,
      familleId: f1.familleId,
    });
    expect(preparation.enfants.map((e) => [e.dejaPresent, e.coche])).toEqual([
      ["cette_session", false],
      ["cette_session", false],
    ]);
  });

  it("refuse un enfant encore présent dans une autre session (la bascule viendra au lot 4)", async () => {
    await ouvrirClasse(a);
    const f1 = await famille(a, "f1");
    await sql(
      a,
      `INSERT INTO "Session" (id, "egliseId", date, debut, fin, statut)
       VALUES ('session_veille', $1, '2026-10-17', now(), now(), 'OUVERTE')`,
      [a.egliseId],
    );
    await sql(
      a,
      `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut, "codeRetrait", "checkinPar")
       VALUES ('p_veille', $1, 'session_veille', $2, $3, 'PRESENT', 'K7RM', 'user_test')`,
      [a.egliseId, f1.enfants[0], a.classeId],
    );
    await expect(
      valider({
        familleId: f1.familleId,
        enfants: [{ enfantId: f1.enfants[0], classeId: a.classeId }],
      }),
    ).rejects.toThrow("Ayo est encore enregistré(e) dans une autre session");
  });

  it("refuse une carte d'une autre famille et un enfant d'une autre famille", async () => {
    await ouvrirClasse(a);
    const f1 = await famille(a, "f1");
    const f2 = await famille(a, "f2");
    await carte(a, f2.familleId, "C", { active: true });
    await expect(
      valider({
        familleId: f1.familleId,
        jeton: jeton("C"),
        enfants: [{ enfantId: f1.enfants[0], classeId: a.classeId }],
      }),
    ).rejects.toThrow("Cette carte n'est pas celle de la famille affichée.");
    await expect(
      valider({
        familleId: f1.familleId,
        enfants: [{ enfantId: f2.enfants[0], classeId: a.classeId }],
      }),
    ).rejects.toThrow(CheckinRefuse);
    expect(await lignes(`SELECT id FROM "Presence"`)).toEqual([]);
  });
});

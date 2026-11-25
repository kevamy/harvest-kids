/**
 * Lot 3, step 2: a child's presence card and the Urgence button (cahier §7.9, ADR 0019). The
 * family's contacts, main contact first; every call logged with its author, channel and
 * number (a number of the family only), its result noted once; an audit entry without the
 * number. Isolation: church B neither reads nor logs on a presence of church A.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { clientEglise, type ClientEglise } from "@/lib/tenant";
import { creerClientPlateforme } from "@/server/plateforme/db";
import { affecteALaPresence, fichePresence } from "@/server/presences";
import {
  UrgenceRefusee,
  contactsUrgence,
  journalAppels,
  journaliserAppel,
  noterResultatAppel,
} from "@/server/urgence";
import {
  type Client,
  type Jeu,
  compterDansEglise,
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

const MERE = "+2290197451233";
const MERE_2 = "+2290197451234";
const MERE_WHATSAPP = "+2290166000001";
const ONCLE = "+2290196000002";

/** Runs SQL as the owner inside a church. */
const sql = (jeu: Jeu, requete: string, valeurs: unknown[] = []) =>
  enEglise(proprietaire, jeu.egliseId, () => proprietaire.query(requete, valeurs));

/** Logged calls of a church, counted as the owner inside it (FORCE RLS). */
const appelsDe = (jeu: Jeu) =>
  enEglise(proprietaire, jeu.egliseId, () =>
    compterDansEglise(proprietaire, "AppelTelephonique", jeu.egliseId),
  );

/** A present child, two guardians (the main contact with three numbers) and authorised people. */
async function famille(jeu: Jeu) {
  await sql(
    jeu,
    `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut, "codeRetrait", "checkinPar")
     VALUES ($1, $2, $3, $4, $5, 'PRESENT', 'K7RM', 'user_accueil')`,
    [`presence_${jeu.egliseId}`, jeu.egliseId, jeu.sessionId, jeu.enfantId, jeu.classeId],
  );
  await sql(
    jeu,
    `INSERT INTO "Tuteur" (id, "egliseId", "familleId", prenom, nom, lien, telephone, telephone2, whatsapp, principal)
     VALUES ($1, $2, $3, 'Afi', 'Mensah', 'Mère', $4, $5, $6, true),
            ($7, $2, $3, 'Kodjo', 'Mensah', 'Père', NULL, NULL, NULL, false)`,
    [
      `tuteur_mere_${jeu.egliseId}`,
      jeu.egliseId,
      jeu.familleId,
      MERE,
      MERE_2,
      MERE_WHATSAPP,
      `tuteur_pere_${jeu.egliseId}`,
    ],
  );
  await sql(
    jeu,
    `INSERT INTO "PersonneAutorisee" (id, "egliseId", "familleId", "tuteurId", prenom, nom, lien, telephone, "photoKey", actif)
     VALUES ($1, $2, $3, $4, 'Afi', 'Mensah', 'Mère', $5, 'eglises/x/photos/mere.webp', true),
            ($6, $2, $3, NULL, 'Koami', 'Mensah', 'Oncle', $7, 'eglises/x/photos/oncle.webp', true),
            ($8, $2, $3, NULL, 'Sena', 'Mensah', 'Tante', '+2290196000003', 'eglises/x/photos/tante.webp', false)`,
    [
      `pa_mere_${jeu.egliseId}`,
      jeu.egliseId,
      jeu.familleId,
      `tuteur_mere_${jeu.egliseId}`,
      MERE,
      `pa_oncle_${jeu.egliseId}`,
      ONCLE,
      `pa_tante_${jeu.egliseId}`,
    ],
  );
  return `presence_${jeu.egliseId}`;
}

beforeAll(() => {
  base = creerClientPlateforme(urlsDeTest().app);
});

beforeAll(async () => {
  proprietaire = await connecter("proprietaire");
});

afterAll(async () => {
  await base?.$disconnect();
  await proprietaire?.end();
});

let presenceA: string;
let presenceB: string;

beforeEach(async () => {
  await viderBase(proprietaire);
  a = await creerEglise(proprietaire, "a");
  b = await creerEglise(proprietaire, "b");
  dbA = clientEglise(base, a.egliseId);
  dbB = clientEglise(base, b.egliseId);
  presenceA = await famille(a);
  presenceB = await famille(b);
});

describe("fiche de présence", () => {
  it("donne l'enfant, sa classe et son statut ; null depuis une autre église", async () => {
    const fiche = await fichePresence(dbA, presenceA);
    expect(fiche).toMatchObject({
      presenceId: presenceA,
      statut: "PRESENT",
      classe: "3–5 ans",
      matricule: "HK-0001",
      infirmerieDepuisMinutes: null,
      enRoute: false,
    });
    expect(await fichePresence(dbB, presenceA)).toBeNull();
  });

  it("un membre n'est affecté qu'à la classe où il est, tant qu'il n'est pas parti", async () => {
    await proprietaire.query(
      `INSERT INTO "User" (id, name, email, "updatedAt")
       VALUES ('user_moniteur', 'Moniteur', 'moniteur@harvest-kids.test', now())`,
    );
    await proprietaire.query(
      `INSERT INTO "Membre" (id, "egliseId", "userId", roles, "updatedAt")
       VALUES ('membre_moniteur', $1, 'user_moniteur', '{MONITEUR}', now())`,
      [a.egliseId],
    );
    await sql(
      a,
      `INSERT INTO "SessionClasse" (id, "egliseId", "sessionId", "classeId") VALUES ('sc_a', $1, $2, $3)`,
      [a.egliseId, a.sessionId, a.classeId],
    );
    await sql(
      a,
      `INSERT INTO "AffectationMoniteur" (id, "egliseId", "sessionClasseId", "membreId")
       VALUES ('aff_1', $1, 'sc_a', 'membre_moniteur')`,
      [a.egliseId],
    );
    expect(await affecteALaPresence(dbA, presenceA, "membre_moniteur")).toBe(true);
    expect(await affecteALaPresence(dbA, presenceA, "membre_autre")).toBe(false);
    await sql(
      a,
      `UPDATE "AffectationMoniteur" SET depart = now() WHERE id = 'aff_1' AND "egliseId" = $1`,
      [a.egliseId],
    );
    expect(await affecteALaPresence(dbA, presenceA, "membre_moniteur")).toBe(false);
    // Church B does not see A's assignment.
    expect(await affecteALaPresence(dbB, presenceA, "membre_moniteur")).toBe(false);
  });
});

describe("contacts d'urgence", () => {
  it("le contact principal d'abord, puis les tuteurs, puis les personnes autorisées actives qui ne sont pas tuteurs", async () => {
    const contacts = await contactsUrgence(dbA, presenceA);
    expect(contacts.map((c) => [c.prenom, c.qualite, c.telephones, c.whatsapp])).toEqual([
      ["Afi", "tuteur", [MERE, MERE_2], MERE_WHATSAPP],
      ["Kodjo", "tuteur", [], null],
      ["Koami", "autorise", [ONCLE], null],
    ]);
    expect(await contactsUrgence(dbB, presenceA)).toEqual([]);
  });
});

describe("journal des appels", () => {
  const appeler = (db: ClientEglise, presenceId: string, numero: string, canal = "tel") =>
    db.$tx((tx) => journaliserAppel(tx, auteur, { presenceId, numero, canal }));
  const auteur = contexteVerifie({ egliseId: "" } as Jeu);

  it("note l'appel (auteur, canal, numéro) et un audit sans le numéro", async () => {
    const { appelId } = await appeler(dbA, presenceA, MERE);
    await appeler(dbA, presenceA, MERE_WHATSAPP, "whatsapp");
    await appeler(dbA, presenceA, ONCLE);

    const journal = await journalAppels(dbA, presenceA);
    expect(journal.map((j) => [j.numero, j.canal, j.resultat, j.userId])).toEqual(
      expect.arrayContaining([
        [MERE, "tel", null, "user_test"],
        [MERE_WHATSAPP, "whatsapp", null, "user_test"],
        [ONCLE, "tel", null, "user_test"],
      ]),
    );
    expect(journal[0]!.heure).toMatch(/^\d{2}:\d{2}$/);

    const { rows } = await sql(
      a,
      `SELECT action, apres FROM "AuditLog" WHERE "egliseId" = $1 AND "entiteId" = $2`,
      [a.egliseId, appelId],
    );
    expect(rows).toEqual([
      { action: "appel.telephone", apres: { presenceId: presenceA, canal: "tel" } },
    ]);
    expect(JSON.stringify(rows)).not.toContain("0197451233");
  });

  it("refuse un numéro qui n'est pas celui d'un contact de la famille", async () => {
    for (const numero of [
      "+2290100000000",
      // An inactive authorised person no longer counts.
      "+2290196000003",
    ]) {
      await expect(appeler(dbA, presenceA, numero), numero).rejects.toThrow(UrgenceRefusee);
    }
    await expect(appeler(dbA, presenceA, "0197451233")).rejects.toThrow("Numéro inconnu");
    await expect(appeler(dbA, presenceA, MERE, "sms")).rejects.toThrow();
    expect(await appelsDe(a)).toBe(0);
  });

  it("isolation A/B : B ne journalise ni ne lit sur une présence de A", async () => {
    await appeler(dbA, presenceA, MERE);
    await expect(appeler(dbB, presenceA, MERE)).rejects.toThrow(UrgenceRefusee);
    expect(await journalAppels(dbB, presenceA)).toEqual([]);
    expect(await appelsDe(b)).toBe(0);
    // B's own child, with the same numbers, is logged in B.
    await appeler(dbB, presenceB, MERE);
    expect(await appelsDe(b)).toBe(1);
    expect(await appelsDe(a)).toBe(1);
  });

  it("le résultat se note une fois, pour un appel de cette présence seulement", async () => {
    const { appelId } = await appeler(dbA, presenceA, MERE);
    const noter = (db: ClientEglise, presenceId: string, resultat: string) =>
      db.$tx((tx) => noterResultatAppel(tx, auteur, presenceId, { appelId, resultat }));

    await expect(noter(dbA, presenceA, "occupe")).rejects.toThrow("Choisissez le résultat");
    await expect(noter(dbB, presenceA, "joint")).rejects.toThrow(UrgenceRefusee);
    await expect(noter(dbA, "presence_autre", "joint")).rejects.toThrow(UrgenceRefusee);
    await noter(dbA, presenceA, "pas_de_reponse");
    await expect(noter(dbA, presenceA, "joint")).rejects.toThrow("déjà noté");

    const [ligne] = await journalAppels(dbA, presenceA);
    expect(ligne!.resultat).toBe("pas_de_reponse");
    const { rows } = await sql(
      a,
      `SELECT count(*)::int AS n FROM "AuditLog"
       WHERE "egliseId" = $1 AND "entiteId" = $2 AND action = 'appel.resultat'`,
      [a.egliseId, appelId],
    );
    expect(rows[0]).toEqual({ n: 1 });
  });
});

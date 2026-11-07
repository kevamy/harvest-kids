/**
 * Lot 2, step 2: sessions and monitors (cahier §7.2, RG-05, RG-12). Today's sessions come
 * from the active services, in the church's day and hours; a class opens at its minimum
 * number of monitors or when a RESPONSABLE forces it; a monitor is in one class at a time.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { clientEglise, type ClientEglise } from "@/lib/tenant";
import {
  AffectationRefusee,
  alertesClasses,
  etatClasses,
  forcerOuverture,
  quitterClasse,
  rejoindreClasse,
} from "@/server/moniteurs-session";
import { creerClientPlateforme } from "@/server/plateforme/db";
import { lectureMembre } from "@/server/plateforme/membres-session";
import {
  SessionRefusee,
  assurerSessionsDuJour,
  cloturerSession,
  listerSessionsDuJour,
  ouvrirSession,
} from "@/server/sessions";
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

const auteur = contexteVerifie;

/** A member of a church with the given roles (platform tables, owner role). */
async function membre(jeu: Jeu, cle: string, roles: string[], actif = true) {
  const id = `membre_${cle}`;
  await proprietaire.query(
    `INSERT INTO "User" (id, name, email, "updatedAt") VALUES ($1, $2, $3, now())`,
    [`user_${cle}`, `Membre ${cle}`, `${cle}@harvest-kids.test`],
  );
  await proprietaire.query(
    `INSERT INTO "Membre" (id, "egliseId", "userId", roles, actif, "updatedAt")
     VALUES ($1, $2, $3, $4::"Role"[], $5, now())`,
    [id, jeu.egliseId, `user_${cle}`, roles, actif],
  );
  return id;
}

/** Audit actions of a church, in order. */
const actions = (jeu: Jeu) =>
  enEglise(proprietaire, jeu.egliseId, async () => {
    const { rows } = await proprietaire.query<{ action: string }>(
      `SELECT action FROM "AuditLog" ORDER BY "createdAt", id`,
    );
    return rows.map((r) => r.action);
  });

const statutSession = (jeu: Jeu) =>
  enEglise(proprietaire, jeu.egliseId, async () => {
    const { rows } = await proprietaire.query<{ statut: string }>(
      `SELECT statut FROM "Session" WHERE id = $1`,
      [jeu.sessionId],
    );
    return rows[0]?.statut;
  });

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

describe("sessions du jour (RG-12)", () => {
  /** Day of the week of today in the church's time zone, read from PostgreSQL. */
  const jourLocal = async () => {
    const { rows } = await proprietaire.query<{ jour: number; date: string }>(
      `SELECT extract(dow FROM (now() AT TIME ZONE 'Africa/Porto-Novo')::date)::int AS jour,
              to_char((now() AT TIME ZONE 'Africa/Porto-Novo')::date, 'YYYY-MM-DD') AS date`,
    );
    return rows[0]!;
  };
  const culte = (jeu: Jeu, id: string, nom: string, jour: number, actif = true) =>
    enEglise(proprietaire, jeu.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "Culte" (id, "egliseId", nom, jour, "heureDebut", "heureFin", actif)
         VALUES ($1, $2, $3, $4, '08:00', '10:00', $5)`,
        [id, jeu.egliseId, nom, jour, actif],
      ),
    );

  it("crée une fois les sessions des cultes actifs du jour, aux heures de l'église", async () => {
    const { jour, date } = await jourLocal();
    await culte(a, "culte_a1", "Culte 1", jour);
    await culte(a, "culte_a2", "Culte inactif", jour, false);
    await culte(a, "culte_a3", "Autre jour", (jour + 1) % 7);
    await culte(b, "culte_b1", "Culte de B", jour);

    expect(await assurerSessionsDuJour(dbA)).toBe(1);
    expect(await assurerSessionsDuJour(dbA)).toBe(0);
    const sessions = await listerSessionsDuJour(dbA);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      culte: "Culte 1",
      statut: "PLANIFIEE",
      heureDebut: "08:00",
      heureFin: "10:00",
    });
    // 08:00 and 10:00 in Porto-Novo (UTC+1, no daylight saving) are 07:00 and 09:00 UTC.
    expect(sessions[0]!.debut.toISOString()).toBe(`${date}T07:00:00.000Z`);
    expect(sessions[0]!.fin.toISOString()).toBe(`${date}T09:00:00.000Z`);

    // Church B's service only creates B's session.
    expect(await listerSessionsDuJour(dbB)).toEqual([]);
    expect(await assurerSessionsDuJour(dbB)).toBe(1);
    expect((await listerSessionsDuJour(dbB)).map((s) => s.culte)).toEqual(["Culte de B"]);
  });

  it("ouvre une session planifiée, une fois, avec ses classes actives et l'audit", async () => {
    expect(await dbA.$tx((tx) => ouvrirSession(tx, auteur(a), a.sessionId))).toBe(true);
    expect(await statutSession(a)).toBe("OUVERTE");
    const classes = await etatClasses(dbA, a.sessionId);
    expect(classes).toEqual([
      expect.objectContaining({ classeId: a.classeId, ouverte: false, moniteurs: [] }),
    ]);
    await expect(dbA.$tx((tx) => ouvrirSession(tx, auteur(a), a.sessionId))).rejects.toThrow(
      new SessionRefusee("Cette session est déjà ouverte."),
    );
    expect(await actions(a)).toEqual(["session.ouverte"]);
  });

  it("isolation A/B : A n'ouvre ni ne clôture une session de B", async () => {
    expect(await dbA.$tx((tx) => ouvrirSession(tx, auteur(a), b.sessionId))).toBe(false);
    expect(await dbA.$tx((tx) => cloturerSession(tx, auteur(a), b.sessionId))).toBe(false);
    expect(await statutSession(b)).toBe("PLANIFIEE");
    expect(await actions(a)).toEqual([]);
  });
});

describe("moniteurs et ouverture des classes (RG-05)", () => {
  let lire: ReturnType<typeof lectureMembre>;
  const rejoindre = (membreId: string, renfort = false, classeId = a.classeId) =>
    dbA.$tx((tx) =>
      rejoindreClasse(tx, auteur(a), lire, {
        sessionId: a.sessionId,
        classeId,
        membreId,
        renfort,
      }),
    );

  beforeEach(async () => {
    lire = lectureMembre(base, { egliseId: a.egliseId });
  });

  it("la classe reste fermée avec un moniteur et s'ouvre au deuxième", async () => {
    const m1 = await membre(a, "m1", ["MONITEUR"]);
    const m2 = await membre(a, "m2", ["MONITEUR"]);
    // Not before the session is opened.
    await expect(rejoindre(m1)).rejects.toThrow(AffectationRefusee);
    await dbA.$tx((tx) => ouvrirSession(tx, auteur(a), a.sessionId));

    expect(await rejoindre(m1)).toMatchObject({ classeOuverte: false, precedente: null });
    expect((await etatClasses(dbA, a.sessionId))[0]).toMatchObject({ ouverte: false });
    expect(await rejoindre(m2)).toMatchObject({ classeOuverte: true });
    expect((await etatClasses(dbA, a.sessionId))[0]).toMatchObject({
      ouverte: true,
      forcee: false,
      sousMinimum: false,
      moniteurs: [
        { membreId: m1, renfort: false },
        { membreId: m2, renfort: false },
      ],
    });
    expect(await actions(a)).toEqual([
      "session.ouverte",
      "moniteur.arrive",
      "moniteur.arrive",
      "classe.ouverte",
    ]);
  });

  it("deux moniteurs qui arrivent en même temps ouvrent la classe", async () => {
    const m1 = await membre(a, "m1", ["MONITEUR"]);
    const m2 = await membre(a, "m2", ["MONITEUR"]);
    await dbA.$tx((tx) => ouvrirSession(tx, auteur(a), a.sessionId));
    await Promise.all([rejoindre(m1), rejoindre(m2)]);
    expect((await etatClasses(dbA, a.sessionId))[0]).toMatchObject({ ouverte: true });
  });

  it("rejoindre une autre classe termine l'affectation précédente", async () => {
    const m1 = await membre(a, "m1", ["MONITEUR"]);
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "Classe" (id, "egliseId", nom, "ageMinMois", "ageMaxMois", ordre)
         VALUES ('classe_a2', $1, '6–8 ans', 72, 107, 2)`,
        [a.egliseId],
      ),
    );
    await dbA.$tx((tx) => ouvrirSession(tx, auteur(a), a.sessionId));
    const { affectationId } = await rejoindre(m1);
    await expect(rejoindre(m1)).rejects.toThrow("Ce moniteur est déjà dans cette classe.");
    expect(await rejoindre(m1, false, "classe_a2")).toMatchObject({ precedente: affectationId });
    const etat = await etatClasses(dbA, a.sessionId);
    expect(etat.map((c) => c.moniteurs.length)).toEqual([0, 1]);
    expect(await actions(a)).toEqual([
      "session.ouverte",
      "moniteur.arrive",
      "moniteur.parti",
      "moniteur.arrive",
    ]);
  });

  it("refuse un compte inactif, un compte d'une autre église et, hors renfort, un non-moniteur", async () => {
    const inactif = await membre(a, "inactif", ["MONITEUR"], false);
    const accueil = await membre(a, "accueil", ["ACCUEIL"]);
    const deB = await membre(b, "b1", ["MONITEUR"]);
    await dbA.$tx((tx) => ouvrirSession(tx, auteur(a), a.sessionId));

    await expect(rejoindre(inactif)).rejects.toThrow(
      "Ce compte n'est pas actif dans cette église.",
    );
    await expect(rejoindre(deB)).rejects.toThrow("Ce compte n'est pas actif dans cette église.");
    await expect(rejoindre(accueil)).rejects.toThrow(/peut l'ajouter comme renfort/);
    expect(await rejoindre(accueil, true)).toMatchObject({ classeOuverte: false });
    expect((await etatClasses(dbA, a.sessionId))[0]!.moniteurs).toEqual([
      { membreId: accueil, renfort: true },
    ]);
  });

  it("une classe ouverte qui passe sous le minimum reste ouverte, en alerte", async () => {
    const m1 = await membre(a, "m1", ["MONITEUR"]);
    const m2 = await membre(a, "m2", ["MONITEUR"]);
    await dbA.$tx((tx) => ouvrirSession(tx, auteur(a), a.sessionId));
    await rejoindre(m1);
    await rejoindre(m2);
    expect(await dbA.$tx((tx) => quitterClasse(tx, auteur(a), m2))).toBe(true);
    expect(await dbA.$tx((tx) => quitterClasse(tx, auteur(a), m2))).toBe(false);
    expect((await etatClasses(dbA, a.sessionId))[0]).toMatchObject({
      ouverte: true,
      sousMinimum: true,
      moniteurs: [{ membreId: m1, renfort: false }],
    });
  });

  it("ouverture forcée par un responsable, avec un motif", async () => {
    // forcePar references the account of the test author (contexteVerifie).
    await proprietaire.query(
      `INSERT INTO "User" (id, name, email, "updatedAt")
       VALUES ('user_test', 'Responsable', 'responsable@harvest-kids.test', now())`,
    );
    await dbA.$tx((tx) => ouvrirSession(tx, auteur(a), a.sessionId));
    const forcer = (motif: unknown) =>
      dbA.$tx((tx) =>
        forcerOuverture(tx, auteur(a), { sessionId: a.sessionId, classeId: a.classeId, motif }),
      );
    await expect(forcer(" ")).rejects.toThrow("Saisissez le motif de l'ouverture forcée.");
    // Never without any monitor in the class (RG-05).
    await expect(forcer("Personne n'est arrivé")).rejects.toThrow(
      "Affectez au moins un moniteur avant de forcer l'ouverture.",
    );
    const m1 = await membre(a, "m1", ["MONITEUR"]);
    await rejoindre(m1);
    await forcer("Un seul moniteur ce matin, le responsable reste avec lui");
    expect((await etatClasses(dbA, a.sessionId))[0]).toMatchObject({
      ouverte: true,
      forcee: true,
      motifForcage: "Un seul moniteur ce matin, le responsable reste avec lui",
      sousMinimum: true,
      sansMoniteur: false,
    });
    await expect(forcer("Encore")).rejects.toThrow("Cette classe est déjà ouverte.");
    const { rows } = await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(`SELECT "forcePar", "forcageMotif" FROM "SessionClasse"`),
    );
    expect(rows).toEqual([
      {
        forcePar: "user_test",
        forcageMotif: "Un seul moniteur ce matin, le responsable reste avec lui",
      },
    ]);
  });
});

describe("alertes des tableaux de bord (cahier §7.2.5)", () => {
  it("une classe ouverte sous le minimum est en alerte, l'alerte maximale à 0 moniteur", async () => {
    const lire = lectureMembre(base, { egliseId: a.egliseId });
    const rejoindre = (membreId: string) =>
      dbA.$tx((tx) =>
        rejoindreClasse(tx, auteur(a), lire, {
          sessionId: a.sessionId,
          classeId: a.classeId,
          membreId,
          renfort: false,
        }),
      );
    const m1 = await membre(a, "m1", ["MONITEUR"]);
    const m2 = await membre(a, "m2", ["MONITEUR"]);
    await dbA.$tx((tx) => ouvrirSession(tx, auteur(a), a.sessionId));
    await rejoindre(m1);
    // A closed class is not an alert: check-in is blocked there anyway (RG-05).
    expect(await alertesClasses(dbA)).toEqual([]);
    await rejoindre(m2);
    expect(await alertesClasses(dbA)).toEqual([]);

    await dbA.$tx((tx) => quitterClasse(tx, auteur(a), m2));
    expect(await alertesClasses(dbA)).toEqual([
      {
        sessionId: a.sessionId,
        culte: null,
        classe: "3–5 ans",
        moniteurs: 1,
        minMoniteurs: 2,
        niveau: "sous_minimum",
      },
    ]);
    await dbA.$tx((tx) => quitterClasse(tx, auteur(a), m1));
    expect(await alertesClasses(dbA)).toMatchObject([{ moniteurs: 0, niveau: "sans_moniteur" }]);
    expect((await etatClasses(dbA, a.sessionId))[0]).toMatchObject({ sansMoniteur: true });

    // Church B sees none of A's alerts.
    expect(await alertesClasses(clientEglise(base, b.egliseId))).toEqual([]);
  });
});

describe("clôture (lot 2 : tous les enfants récupérés)", () => {
  it("refuse tant qu'un enfant n'est pas récupéré, puis clôture et fait sortir les moniteurs", async () => {
    const m1 = await membre(a, "m1", ["MONITEUR"]);
    await dbA.$tx((tx) => ouvrirSession(tx, auteur(a), a.sessionId));
    await dbA.$tx((tx) =>
      rejoindreClasse(tx, auteur(a), lectureMembre(base, { egliseId: a.egliseId }), {
        sessionId: a.sessionId,
        classeId: a.classeId,
        membreId: m1,
        renfort: false,
      }),
    );
    await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut, "codeRetrait", "checkinPar")
         VALUES ('p_1', $1, $2, $3, $4, 'PRESENT', 'K7RM', 'user_test')`,
        [a.egliseId, a.sessionId, a.enfantId, a.classeId],
      ),
    );
    await expect(dbA.$tx((tx) => cloturerSession(tx, auteur(a), a.sessionId))).rejects.toThrow(
      "Un enfant n'est pas encore récupéré : remettez-le à ses parents avant de clôturer.",
    );

    await enEglise(proprietaire, a.egliseId, async () => {
      await proprietaire.query(
        `INSERT INTO "PersonneAutorisee" (id, "egliseId", "familleId", prenom, nom, lien, "photoKey")
         VALUES ('pa_1', $1, $2, 'Mireille', 'Adjovi', 'Mère', 'eglises/a/photos/pa.webp')`,
        [a.egliseId, a.familleId],
      );
      await proprietaire.query(
        `UPDATE "Presence" SET statut = 'RECUPERE', "recuperePar" = 'pa_1' WHERE id = 'p_1'`,
      );
    });
    expect(await dbA.$tx((tx) => cloturerSession(tx, auteur(a), a.sessionId))).toBe(true);
    expect(await statutSession(a)).toBe("CLOTUREE");
    expect((await etatClasses(dbA, a.sessionId))[0]!.moniteurs).toEqual([]);
    await expect(dbA.$tx((tx) => cloturerSession(tx, auteur(a), a.sessionId))).rejects.toThrow(
      "Seule une session ouverte se clôture.",
    );
    expect((await actions(a)).at(-1)).toBe("session.cloturee");
  });
});

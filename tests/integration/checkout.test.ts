/**
 * Lot 2, step 5a: check-out at the reception desk (cahier §7.6, RG-04, RG-06, RG-07, RG-16).
 * The scan or the code only reads; validating hands over the ticked children to an authorised
 * person of the family, activates a pending card (first scan), and writes an EvenementPresence
 * and an audit entry per child, in one transaction. Wrong codes are counted per tablet and per
 * session (5 in 15 minutes), and per session on every tablet (20); time is moved by moving the
 * stored dates back.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { clientEglise, type ClientEglise } from "@/lib/tenant";
import {
  CheckoutRefuse,
  preparerCheckout,
  rechercherPourCheckout,
  retraitExceptionnel,
  validerCheckout,
} from "@/server/checkout";
import { detailIncident, listerIncidents } from "@/server/incidents";
import {
  REGLE_CODES_SESSION,
  REGLE_CODE_RETRAIT,
  cleCodeRetrait,
  cleCodesSession,
  compterCodeErroneDans,
  consommer,
  etatCodeRetrait,
  etatLimite,
  sessionsCodesBloques,
  tablettesBloquees,
} from "@/server/plateforme/limitation";
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

/**
 * A finalised family with two children checked in to the fixture class with the code given
 * (statuses given), a main contact and two authorised persons (one inactive).
 */
async function famille(jeu: Jeu, cle: string, code: string, statuts = ["EN_SALLE", "PRESENT"]) {
  const familleId = `famille_${cle}`;
  await sql(
    jeu,
    `INSERT INTO "Famille" (id, "egliseId", nom, "finaliseeLe", "updatedAt")
     VALUES ($1, $2, $3, now(), now())`,
    [familleId, jeu.egliseId, `Famille ${cle}`],
  );
  const presences: string[] = [];
  for (const [i, statut] of statuts.entries()) {
    const enfantId = `${familleId}_${i}`;
    await sql(
      jeu,
      `INSERT INTO "Enfant" (id, "egliseId", matricule, "familleId", prenom, nom, "dateNaissance", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [
        enfantId,
        jeu.egliseId,
        `HK-${cle}${i}`,
        familleId,
        ["Ayo", "Sèna", "Koffi"][i],
        cle,
        `${2019 + i}-05-02`,
      ],
    );
    const presenceId = `presence_${enfantId}`;
    await sql(
      jeu,
      // A child at the infirmerie has its sending time (CHECK Presence_infirmerie_statut).
      `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut,
                               "codeRetrait", "checkinPar", "infirmerieLe")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'user_accueil', CASE WHEN $8 THEN now() END)`,
      [
        presenceId,
        jeu.egliseId,
        jeu.sessionId,
        enfantId,
        jeu.classeId,
        statut,
        code,
        statut === "INFIRMERIE",
      ],
    );
    presences.push(presenceId);
  }
  await sql(
    jeu,
    `INSERT INTO "Tuteur" (id, "egliseId", "familleId", prenom, nom, lien, telephone, principal)
     VALUES ($1, $2, $3, 'Afi', $4, 'Mère', '+2290197451233', true)`,
    [`tuteur_${cle}`, jeu.egliseId, familleId, cle],
  );
  for (const [suffixe, prenom, actif] of [
    ["mere", "Afi", true],
    ["oncle", "Koami", false],
  ] as const) {
    await sql(
      jeu,
      `INSERT INTO "PersonneAutorisee" (id, "egliseId", "familleId", prenom, nom, lien, "photoKey", actif)
       VALUES ($1, $2, $3, $4, $5, 'Mère', $6, $7)`,
      [
        `pa_${cle}_${suffixe}`,
        jeu.egliseId,
        familleId,
        prenom,
        cle,
        `eglises/${jeu.egliseId}/photos/${suffixe}.webp`,
        actif,
      ],
    );
  }
  return { familleId, presences };
}

/** A card of the family (pending unless active), known by its clear token. */
const carte = (
  jeu: Jeu,
  familleId: string,
  lettre: string,
  etat: { active?: boolean; enfantId?: string } = {},
) =>
  sql(
    jeu,
    `INSERT INTO "CarteFamille" (id, "egliseId", "familleId", "enfantId", "tokenHash", "activeLe")
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() END)`,
    [
      `carte_${lettre}`,
      jeu.egliseId,
      familleId,
      etat.enfantId ?? null,
      empreinte(jeton(lettre)),
      !!etat.active,
    ],
  );

const preparer = (saisie: { jeton: string } | { code: string }) =>
  preparerCheckout(dbA, aucunMoniteur, { sessionId: a.sessionId, ...saisie });

const valider = (saisie: Record<string, unknown>) =>
  dbA.$tx((tx) =>
    validerCheckout(tx, auteur(a), aucunMoniteur, { sessionId: a.sessionId, ...saisie }),
  );

/** Rows of church A; `requete` filters on `"egliseId" = $1`. */
const lignes = async (requete: string) => (await sql(a, requete, [a.egliseId])).rows;

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
  await dbA.$tx((tx) => ouvrirSession(tx, auteur(a), a.sessionId));
  await clientEglise(base, b.egliseId).$tx((tx) => ouvrirSession(tx, auteur(b), b.sessionId));
});

describe("préparation (lecture seule)", () => {
  it("une carte famille montre les enfants à remettre, infirmerie en tête, et les personnes autorisées actives", async () => {
    const { familleId, presences } = await famille(a, "f1", "K7MP", ["EN_SALLE", "INFIRMERIE"]);
    await carte(a, familleId, "A", { active: true });

    const preparation = await preparer({ jeton: jeton("A") });
    expect(preparation.famille).toEqual({ id: familleId, nom: "Famille f1" });
    expect(preparation.moyen).toEqual({ type: "carte", carte: "famille", enAttente: false });
    expect(preparation.enfants).toEqual([
      expect.objectContaining({
        presenceId: presences[1],
        statut: "INFIRMERIE",
        lieu: "Infirmerie",
        coche: true,
      }),
      expect.objectContaining({
        presenceId: presences[0],
        statut: "EN_SALLE",
        lieu: "3–5 ans",
        coche: true,
      }),
    ]);
    expect(preparation.personnes.map((p) => p.id)).toEqual(["pa_f1_mere"]);
    expect(preparation.contact).toEqual({
      prenom: "Afi",
      nom: "f1",
      telephone: "+2290197451233",
      whatsapp: null,
    });
  });

  it("une carte enfant présélectionne cet enfant, les autres sont visibles non cochés (RG-16)", async () => {
    const { familleId } = await famille(a, "f1", "K7MP");
    await carte(a, familleId, "E", { active: true, enfantId: `${familleId}_1` });

    const { enfants, moyen } = await preparer({ jeton: jeton("E") });
    expect(moyen).toMatchObject({ carte: "enfant" });
    expect(enfants.map((e) => [e.prenom, e.coche])).toEqual([
      ["Ayo", false],
      ["Sèna", true],
    ]);
  });

  it("le code de retrait ne vaut que dans sa session (RG-04) ; un code mal formé n'est pas compté", async () => {
    const { familleId } = await famille(a, "f1", "K7MP");
    expect((await preparer({ code: " k7mp " })).famille.id).toBe(familleId);

    await expect(preparer({ code: "ZZZZ" })).rejects.toThrow(
      new CheckoutRefuse(
        "Ce code ne correspond à aucune famille de cette session : vérifiez-le avec le parent, ou scannez sa carte.",
        true,
      ),
    );
    const erreur = await preparer({ code: "K7M" }).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(CheckoutRefuse);
    expect((erreur as CheckoutRefuse).codeErrone).toBe(false);

    // The same code in another session of A: refused there.
    await sql(
      a,
      `INSERT INTO "Session" (id, "egliseId", date, debut, fin, statut)
       VALUES ('session_a2', $1, '2026-10-18', now(), now() + interval '2 hours', 'OUVERTE')`,
      [a.egliseId],
    );
    await expect(
      preparerCheckout(dbA, aucunMoniteur, { sessionId: "session_a2", code: "K7MP" }),
    ).rejects.toMatchObject({ codeErrone: true });
  });

  it("refuse une famille sans enfant à remettre, et une carte inconnue", async () => {
    const { familleId } = await famille(a, "f1", "K7MP", []);
    await carte(a, familleId, "A", { active: true });
    await expect(preparer({ jeton: jeton("A") })).rejects.toThrow(
      "Aucun enfant de cette famille n'est à récupérer dans cette session : ils sont déjà récupérés, ou enregistrés dans une autre session.",
    );
    await expect(preparer({ jeton: jeton("Z") })).rejects.toThrow(CheckoutRefuse);
  });
});

describe("validation", () => {
  it("remet les enfants cochés à la personne touchée : RECUPERE, événement, audit, carte en attente activée", async () => {
    const { familleId, presences } = await famille(a, "f1", "K7MP");
    await carte(a, familleId, "A");

    expect(
      await valider({
        familleId,
        jeton: jeton("A"),
        personneAutoriseeId: "pa_f1_mere",
        presenceIds: [presences[0]],
      }),
    ).toEqual({ enfants: ["Ayo"], personne: { prenom: "Afi", nom: "f1" } });

    expect(
      await lignes(
        `SELECT id, statut, "recuperePar", "remisPar", "recupereLe" IS NOT NULL AS horodate
         FROM "Presence" WHERE "egliseId" = $1 ORDER BY id`,
      ),
    ).toEqual([
      {
        id: presences[0],
        statut: "RECUPERE",
        recuperePar: "pa_f1_mere",
        remisPar: "user_test",
        horodate: true,
      },
      { id: presences[1], statut: "PRESENT", recuperePar: null, remisPar: null, horodate: false },
    ]);
    expect(
      await lignes(`SELECT type, detail FROM "EvenementPresence" WHERE "egliseId" = $1`),
    ).toEqual([
      {
        type: "checkout",
        detail: {
          statut: "RECUPERE",
          depuis: "EN_SALLE",
          personneAutoriseeId: "pa_f1_mere",
          carte: "scan",
        },
      },
    ]);
    expect(
      (
        await lignes(`SELECT action FROM "AuditLog" WHERE "egliseId" = $1 ORDER BY "createdAt", id`)
      ).map((l) => l.action),
    ).toEqual(["session.ouverte", "carte.activee", "presence.checkout"]);
    expect(
      await lignes(
        `SELECT "activeLe" IS NOT NULL AS active FROM "CarteFamille" WHERE "egliseId" = $1`,
      ),
    ).toEqual([{ active: true }]);
  });

  it("refuse une personne inactive ou d'une autre famille, et un code qui n'est pas celui de la famille", async () => {
    const f1 = await famille(a, "f1", "K7MP");
    await famille(a, "f2", "QRST");
    const saisie = { familleId: f1.familleId, code: "K7MP", presenceIds: [f1.presences[0]] };

    for (const personneAutoriseeId of ["pa_f1_oncle", "pa_f2_mere"]) {
      await expect(valider({ ...saisie, personneAutoriseeId })).rejects.toThrow(
        "Cette personne n'est pas autorisée pour cette famille : touchez une photo de la liste.",
      );
    }
    await expect(
      valider({ ...saisie, code: "QRST", personneAutoriseeId: "pa_f1_mere" }),
    ).rejects.toMatchObject({ codeErrone: true });
    expect(
      await lignes(`SELECT id FROM "Presence" WHERE "egliseId" = $1 AND statut = 'RECUPERE'`),
    ).toEqual([]);
  });

  it("nomme les enfants remis du plus âgé au plus jeune, quel que soit l'ordre des lignes", async () => {
    const { familleId, presences } = await famille(a, "f1", "K7MP", [
      "EN_SALLE",
      "EN_SALLE",
      "PRESENT",
    ]);
    // Koffi, inserted last, is the eldest: the order of the rows is not the family's.
    await sql(
      a,
      `UPDATE "Enfant" SET "dateNaissance" = '2015-03-01' WHERE id = $1 AND "egliseId" = $2`,
      [`${familleId}_2`, a.egliseId],
    );
    const resultat = await valider({
      familleId,
      code: "K7MP",
      personneAutoriseeId: "pa_f1_mere",
      presenceIds: presences,
    });
    expect(resultat.enfants).toEqual(["Koffi", "Ayo", "Sèna"]);
  });

  it("deux tablettes remettent le même enfant en même temps : une seule réussit", async () => {
    const { familleId, presences } = await famille(a, "f1", "K7MP");
    const saisie = {
      familleId,
      code: "K7MP",
      personneAutoriseeId: "pa_f1_mere",
      presenceIds: [presences[0]],
    };
    const resultats = await Promise.allSettled([valider(saisie), valider(saisie)]);
    expect(resultats.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await lignes(`SELECT id FROM "EvenementPresence" WHERE "egliseId" = $1`)).toHaveLength(
      1,
    );
  });

  it("isolation A/B : A ne prépare ni ne remet un enfant de B", async () => {
    const fb = await famille(b, "fb", "K7MP");
    await carte(b, fb.familleId, "B", { active: true });

    await expect(preparer({ jeton: jeton("B") })).rejects.toThrow(
      "Cette carte n'appartient pas à cette église.",
    );
    await expect(preparer({ code: "K7MP" })).rejects.toMatchObject({ codeErrone: true });
    await expect(
      valider({
        familleId: fb.familleId,
        code: "K7MP",
        personneAutoriseeId: "pa_fb_mere",
        presenceIds: [fb.presences[0]],
      }),
    ).rejects.toThrow(CheckoutRefuse);
    const { rows } = await sql(
      b,
      `SELECT statut FROM "Presence" WHERE id = $1 AND "egliseId" = $2`,
      [fb.presences[0], b.egliseId],
    );
    expect(rows).toEqual([{ statut: "EN_SALLE" }]);
  });
});

describe("ni carte ni code", () => {
  it("cherche les familles de la session par nom, prénom ou matricule, sans voir l'autre église", async () => {
    const { familleId } = await famille(a, "f1", "K7MP");
    await famille(b, "f1b", "K7MP");
    for (const terme of ["Famille f1", "sèna", "hk-f11"]) {
      expect(await rechercherPourCheckout(dbA, a.sessionId, terme)).toEqual([
        { id: familleId, nom: "Famille f1", prenoms: ["Ayo", "Sèna"] },
      ]);
    }
    expect(await rechercherPourCheckout(dbA, a.sessionId, "f1b")).toEqual([]);
    expect(await rechercherPourCheckout(dbA, a.sessionId, "a")).toEqual([]);
  });

  it("refuse sans la confirmation d'un second membre ; avec elle, la trace dans l'événement et l'audit", async () => {
    const { familleId, presences } = await famille(a, "f1", "K7MP");
    const saisie = { familleId, personneAutoriseeId: "pa_f1_mere", presenceIds: [presences[0]] };
    await expect(valider(saisie)).rejects.toThrow(
      "Sans carte ni code, un second membre de l'équipe confirme le retrait avec son PIN.",
    );

    await dbA.$tx((tx) =>
      validerCheckout(
        tx,
        auteur(a),
        aucunMoniteur,
        { sessionId: a.sessionId, ...saisie },
        { secondMembreUserId: "user_collegue" },
      ),
    );
    expect(await lignes(`SELECT detail FROM "EvenementPresence" WHERE "egliseId" = $1`)).toEqual([
      {
        detail: {
          statut: "RECUPERE",
          depuis: "EN_SALLE",
          personneAutoriseeId: "pa_f1_mere",
          carte: "recherche",
          secondMembre: "user_collegue",
        },
      },
    ]);
    expect(
      await lignes(
        `SELECT apres FROM "AuditLog" WHERE "egliseId" = $1 AND action = 'presence.checkout'`,
      ),
    ).toEqual([
      {
        apres: {
          statut: "RECUPERE",
          personneAutoriseeId: "pa_f1_mere",
          secondMembre: "user_collegue",
        },
      },
    ]);
  });
});

describe("check-out en salle : les seuls enfants de la classe", () => {
  /** Ayo in the fixture class, Sèna in a second class of A. */
  async function familleDansDeuxClasses() {
    const f = await famille(a, "f1", "K7MP");
    await sql(
      a,
      `INSERT INTO "Classe" (id, "egliseId", nom, "ageMinMois", "ageMaxMois")
       VALUES ('classe_a2', $1, '6–8 ans', 72, 107)`,
      [a.egliseId],
    );
    await sql(
      a,
      `UPDATE "Presence" SET "classeId" = 'classe_a2' WHERE id = $1 AND "egliseId" = $2`,
      [f.presences[1], a.egliseId],
    );
    return f;
  }

  it("ne propose que les enfants de la classe ; refuse une famille qui n'y a aucun enfant", async () => {
    await familleDansDeuxClasses();
    const { enfants } = await preparerCheckout(
      dbA,
      aucunMoniteur,
      { sessionId: a.sessionId, code: "K7MP" },
      { classeId: a.classeId },
    );
    expect(enfants.map((e) => [e.prenom, e.remettable, e.coche, e.lieu])).toEqual([
      ["Ayo", true, true, "3–5 ans"],
      ["Sèna", false, false, "6–8 ans"],
    ]);
    await expect(
      preparerCheckout(
        dbA,
        aucunMoniteur,
        { sessionId: a.sessionId, code: "K7MP" },
        { classeId: "classe_vide" },
      ),
    ).rejects.toThrow(
      "Aucun enfant de cette famille n'est dans cette classe : accompagnez le parent à l'accueil.",
    );
  });

  it("refuse de remettre en salle un enfant d'une autre classe, sans rien écrire", async () => {
    const { familleId, presences } = await familleDansDeuxClasses();
    await expect(
      dbA.$tx((tx) =>
        validerCheckout(
          tx,
          auteur(a),
          aucunMoniteur,
          {
            sessionId: a.sessionId,
            familleId,
            code: "K7MP",
            personneAutoriseeId: "pa_f1_mere",
            presenceIds: presences,
          },
          undefined,
          { classeId: a.classeId },
        ),
      ),
    ).rejects.toThrow(
      "Un enfant coché n'est pas dans cette classe, ou vient d'être récupéré : rechargez la famille.",
    );
    expect(
      await lignes(`SELECT id FROM "Presence" WHERE "egliseId" = $1 AND statut = 'RECUPERE'`),
    ).toEqual([]);
  });
});

describe("retrait exceptionnel autorisé par le responsable", () => {
  /** The accounts that authorise and hand over (RetraitExceptionnel references User). */
  async function comptes() {
    await proprietaire.query(
      `INSERT INTO "User" (id, name, email, "updatedAt") VALUES
         ('user_test', 'Agent test', 'agent@harvest-kids.test', now()),
         ('user_resp', 'Responsable test', 'resp@harvest-kids.test', now())`,
    );
  }

  const exceptionnel = (saisie: Record<string, unknown>) =>
    dbA.$tx((tx) =>
      retraitExceptionnel(
        tx,
        auteur(a),
        { sessionId: a.sessionId, ...saisie },
        { autoriseParUserId: "user_resp", photoKey: `eglises/${a.egliseId}/retraits/x.webp` },
      ),
    );

  it("crée l'incident, le retrait lié et remet les enfants, dans une seule transaction", async () => {
    await comptes();
    const { familleId, presences } = await famille(a, "f1", "K7MP");

    const resultat = await exceptionnel({
      familleId,
      presenceIds: presences,
      nom: "Kossi Dossou",
      lien: "Oncle",
      telephone: "+2290197451233",
      motif: "La mère a confirmé par téléphone",
    });
    expect(resultat).toMatchObject({ enfants: ["Ayo", "Sèna"], nom: "Kossi Dossou" });

    expect(
      await lignes(`SELECT type, personnes, "declarePar" FROM "Incident" WHERE "egliseId" = $1`),
    ).toEqual([
      { type: "RETRAIT_NON_AUTORISE", personnes: "Kossi Dossou (Oncle)", declarePar: "user_test" },
    ]);
    expect(
      await lignes(
        `SELECT nom, telephone, "photoKey", "autorisePar", "remisPar", "incidentId"
         FROM "RetraitExceptionnel" WHERE "egliseId" = $1`,
      ),
    ).toEqual([
      {
        nom: "Kossi Dossou",
        telephone: "+2290197451233",
        photoKey: `eglises/${a.egliseId}/retraits/x.webp`,
        autorisePar: "user_resp",
        remisPar: "user_test",
        incidentId: resultat.incidentId,
      },
    ]);
    expect(
      await lignes(
        `SELECT statut, "recuperePar", "retraitExceptionnelId" IS NOT NULL AS exceptionnel
         FROM "Presence" WHERE "egliseId" = $1 ORDER BY id`,
      ),
    ).toEqual([
      { statut: "RECUPERE", recuperePar: null, exceptionnel: true },
      { statut: "RECUPERE", recuperePar: null, exceptionnel: true },
    ]);
    expect(
      (
        await lignes(`SELECT action FROM "AuditLog" WHERE "egliseId" = $1 ORDER BY "createdAt", id`)
      ).map((l) => l.action),
    ).toEqual([
      "session.ouverte",
      "incident.cree",
      "retrait.exceptionnel",
      "presence.checkout",
      "presence.checkout",
    ]);

    // The incident's detail carries the photo key; the list never does.
    const detail = await detailIncident(dbA, resultat.incidentId);
    expect(detail?.retrait).toMatchObject({
      nom: "Kossi Dossou",
      photoKey: `eglises/${a.egliseId}/retraits/x.webp`,
      enfants: [
        { prenom: "Ayo", matricule: "HK-f10" },
        { prenom: "Sèna", matricule: "HK-f11" },
      ],
    });
    const liste = await listerIncidents(dbA);
    expect(liste).toHaveLength(1);
    expect(JSON.stringify(liste)).not.toContain("retraits/");
    // Isolation A/B: B sees neither the incident nor its detail.
    const dbB = clientEglise(base, b.egliseId);
    expect(await listerIncidents(dbB)).toEqual([]);
    expect(await detailIncident(dbB, resultat.incidentId)).toBeNull();
  });

  it("refuse un motif vide, un numéro mal formé et un enfant d'une autre famille, sans rien écrire", async () => {
    await comptes();
    const f1 = await famille(a, "f1", "K7MP");
    const f2 = await famille(a, "f2", "QRST");
    const saisie = { familleId: f1.familleId, presenceIds: [f1.presences[0]], nom: "Kossi" };

    await expect(exceptionnel({ ...saisie, motif: " " })).rejects.toThrow(
      "Indiquez le motif du retrait exceptionnel.",
    );
    await expect(exceptionnel({ ...saisie, motif: "Appel", telephone: "0197" })).rejects.toThrow(
      "Le numéro de téléphone n'est pas valide.",
    );
    await expect(
      exceptionnel({ ...saisie, motif: "Appel", presenceIds: [f2.presences[0]] }),
    ).rejects.toThrow(CheckoutRefuse);
    expect(await lignes(`SELECT id FROM "Incident" WHERE "egliseId" = $1`)).toEqual([]);
  });
});

describe("codes erronés : 5 par tablette et par session en 15 minutes", () => {
  it("bloque la tablette au cinquième, pour cette session seulement, puis la libère après la fenêtre", async () => {
    const cle = cleCodeRetrait(a.egliseId, a.sessionId, "tablette_1");
    const maintenant = new Date();
    for (let i = 0; i < REGLE_CODE_RETRAIT.max - 1; i++) {
      await consommer(base, cle, REGLE_CODE_RETRAIT, maintenant);
    }
    expect(await etatLimite(base, cle, REGLE_CODE_RETRAIT, maintenant)).toMatchObject({
      bloque: false,
      essais: 4,
    });
    await consommer(base, cle, REGLE_CODE_RETRAIT, maintenant);
    expect(await etatLimite(base, cle, REGLE_CODE_RETRAIT, maintenant)).toMatchObject({
      bloque: true,
      essais: 5,
    });
    // Another tablet, or another session: not blocked.
    const autre = cleCodeRetrait(a.egliseId, a.sessionId, "tablette_2");
    expect((await etatLimite(base, autre, REGLE_CODE_RETRAIT, maintenant)).bloque).toBe(false);
    // The reception desk of A sees the blocked tablet; B's does not.
    expect(await tablettesBloquees(base, a.egliseId, maintenant)).toEqual([
      { sessionId: a.sessionId, reessayerDansMs: REGLE_CODE_RETRAIT.fenetreMs },
    ]);
    expect(await tablettesBloquees(base, b.egliseId, maintenant)).toEqual([]);

    // 15 minutes later (the stored window start moved back): free again.
    await proprietaire.query(
      `UPDATE "AuthRateLimit" SET "lastRequest" = "lastRequest" - $2 WHERE key = $1`,
      [cle, REGLE_CODE_RETRAIT.fenetreMs],
    );
    expect((await etatLimite(base, cle, REGLE_CODE_RETRAIT, maintenant)).bloque).toBe(false);
    expect(await tablettesBloquees(base, a.egliseId, maintenant)).toEqual([]);
  });
});

describe("codes erronés : 20 par session de culte, toutes tablettes et connexions confondues", () => {
  it("5 erreurs, déconnexion, reconnexion : le compteur de la session continue jusqu'au blocage de toutes les tablettes et à l'alerte", async () => {
    const maintenant = new Date();
    const erreur = (connexion: string) =>
      compterCodeErroneDans(base, a.egliseId, a.sessionId, connexion, maintenant);

    // First sign-in: 5 wrong codes block this tablet only.
    for (let i = 1; i < REGLE_CODE_RETRAIT.max; i++) {
      expect(await erreur("connexion_1")).toMatchObject({
        bloque: false,
        essais: i,
        essaisSession: i,
        restants: REGLE_CODE_RETRAIT.max - i,
        prochainBlocage: "tablette",
      });
    }
    expect(await erreur("connexion_1")).toMatchObject({ bloque: "tablette", essaisSession: 5 });
    expect(await sessionsCodesBloques(base, a.egliseId, maintenant)).toEqual([]);

    // Signed out and in again: a new tablet counter, but the session one goes on.
    expect(await etatCodeRetrait(base, a.egliseId, a.sessionId, "connexion_2", maintenant)).toEqual(
      {
        bloque: false,
        reessayerDansMs: 0,
        essais: 0,
        essaisSession: 5,
        restants: 5,
        prochainBlocage: "tablette",
      },
    );
    for (const connexion of ["connexion_2", "connexion_3"]) {
      for (let i = 0; i < REGLE_CODE_RETRAIT.max; i++) await erreur(connexion);
    }
    // 15 wrong codes; on a fourth sign-in, both blocks are as near, and the session one is
    // the one announced.
    for (let i = 1; i < REGLE_CODE_RETRAIT.max; i++) {
      expect(await erreur("connexion_4")).toMatchObject({
        bloque: false,
        essais: i,
        essaisSession: 15 + i,
        restants: REGLE_CODES_SESSION.max - 15 - i,
        prochainBlocage: "session",
      });
    }
    expect(await erreur("connexion_4")).toMatchObject({
      bloque: "session",
      essaisSession: REGLE_CODES_SESSION.max,
      restants: 0,
    });

    // A fresh sign-in, or another tablet: code entry stays blocked for the whole session.
    expect(
      await etatCodeRetrait(base, a.egliseId, a.sessionId, "connexion_5", maintenant),
    ).toMatchObject({ bloque: "session", essais: 0 });
    // The reception desk of A gets the alert; B's does not, nor another session of A.
    expect(await sessionsCodesBloques(base, a.egliseId, maintenant)).toEqual([a.sessionId]);
    expect(await sessionsCodesBloques(base, b.egliseId, maintenant)).toEqual([]);
    expect(
      (await etatCodeRetrait(base, a.egliseId, "autre_session", "connexion_5", maintenant)).bloque,
    ).toBe(false);
    expect(
      (await etatCodeRetrait(base, b.egliseId, b.sessionId, "connexion_5", maintenant)).bloque,
    ).toBe(false);

    // The window covers the session whole: still blocked 15 minutes later, free a day later.
    const reculer = (ms: number) =>
      proprietaire.query(
        `UPDATE "AuthRateLimit" SET "lastRequest" = "lastRequest" - $2 WHERE key = $1`,
        [cleCodesSession(a.egliseId, a.sessionId), ms],
      );
    await reculer(REGLE_CODE_RETRAIT.fenetreMs);
    expect(
      (await etatCodeRetrait(base, a.egliseId, a.sessionId, "connexion_5", maintenant)).bloque,
    ).toBe("session");
    await reculer(REGLE_CODES_SESSION.fenetreMs);
    expect(
      (await etatCodeRetrait(base, a.egliseId, a.sessionId, "connexion_5", maintenant)).bloque,
    ).toBe(false);
    expect(await sessionsCodesBloques(base, a.egliseId, maintenant)).toEqual([]);
  });
});

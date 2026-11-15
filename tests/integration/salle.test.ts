/**
 * Lot 2, step 4: arrival in class (cahier §7.4, ADR 0015). Only the members assigned to the
 * class confirm (touch or scan, a scan never activates a card); a confirmation is undone by
 * its author within 1 minute, afterwards by a RESPONSABLE with a reason; every change writes
 * an EvenementPresence and an audit entry in the same transaction. Delays use the database
 * clock: tests move time by moving the stored dates back.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { clientEglise, type ClientEglise, type ContexteEglise } from "@/lib/tenant";
import { creerClientPlateforme } from "@/server/plateforme/db";
import {
  SalleRefusee,
  alertesNonArrives,
  annulerEnSalle,
  classeDeSession,
  confirmerParScan,
  confirmerParToucher,
  listeDeClasse,
  type ClasseDeSession,
} from "@/server/salle";
import { ouvrirSession } from "@/server/sessions";
import {
  type Client,
  type Jeu,
  codeErreur,
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
let classeA: ClasseDeSession;
let autreClasseA: ClasseDeSession;

const empreinte = (valeur: string) => createHash("sha256").update(valeur, "utf8").digest("hex");
const jetonCarte = (lettre: string) => `HKF1.${lettre.repeat(22)}`;
const aucunMoniteur = async () => false;

/** Runs SQL as the owner inside a church. */
const sql = (jeu: Jeu, requete: string, valeurs: unknown[] = []) =>
  enEglise(proprietaire, jeu.egliseId, () => proprietaire.query(requete, valeurs));

/** A member of the church (platform tables), with the given roles. */
async function membre(jeu: Jeu, cle: string, roles: string[]): Promise<ContexteEglise> {
  await proprietaire.query(
    `INSERT INTO "User" (id, name, email, "updatedAt") VALUES ($1, $2, $3, now())`,
    [`user_${cle}`, `Membre ${cle}`, `${cle}@harvest-kids.test`],
  );
  await proprietaire.query(
    `INSERT INTO "Membre" (id, "egliseId", "userId", roles, actif, "updatedAt")
     VALUES ($1, $2, $3, $4::"Role"[], true, now())`,
    [`membre_${cle}`, jeu.egliseId, `user_${cle}`, roles],
  );
  return {
    ...contexteVerifie(jeu),
    userId: `user_${cle}`,
    membreId: `membre_${cle}`,
    roles,
  } as unknown as ContexteEglise;
}

/** Assigns the member to the class of the session (no departure). */
const affecter = (jeu: Jeu, classe: ClasseDeSession, auteur: ContexteEglise, renfort = false) =>
  sql(
    jeu,
    `INSERT INTO "AffectationMoniteur" (id, "egliseId", "sessionClasseId", "membreId", renfort)
     VALUES ($1, $2, $3, $4, $5)`,
    [`aff_${auteur.membreId}`, jeu.egliseId, classe.sessionClasseId, auteur.membreId, renfort],
  );

/** A finalised family; each child is PRESENT in the given class of the session. */
async function famille(jeu: Jeu, cle: string, classes: string[]) {
  const familleId = `famille_${cle}`;
  await sql(
    jeu,
    `INSERT INTO "Famille" (id, "egliseId", nom, "finaliseeLe", "updatedAt")
     VALUES ($1, $2, $3, now(), now())`,
    [familleId, jeu.egliseId, `Famille ${cle}`],
  );
  const presences: string[] = [];
  for (const [i, classeId] of classes.entries()) {
    const enfantId = `${familleId}_${i}`;
    await sql(
      jeu,
      `INSERT INTO "Enfant" (id, "egliseId", matricule, "familleId", prenom, nom, "dateNaissance",
                             alertes, "alerteDetail", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, '2021-05-02', $7, $8, now())`,
      [
        enfantId,
        jeu.egliseId,
        `HK-${cle}${i}`,
        familleId,
        ["Ayo", "Sèna", "Koffi"][i],
        cle,
        i === 0 ? ["ALLERGIE_ALIMENTAIRE"] : [],
        i === 0 ? "arachides" : null,
      ],
    );
    const presenceId = `presence_${enfantId}`;
    await sql(
      jeu,
      `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut,
                               "codeRetrait", "checkinPar")
       VALUES ($1, $2, $3, $4, $5, 'PRESENT', 'K7MP', 'user_accueil')`,
      [presenceId, jeu.egliseId, jeu.sessionId, enfantId, classeId],
    );
    presences.push(presenceId);
  }
  return { familleId, presences };
}

const statut = async (jeu: Jeu, presenceId: string) =>
  (
    await sql(
      jeu,
      `SELECT statut, "enSalleLe" IS NOT NULL AS "enSalle" FROM "Presence"
       WHERE id = $1 AND "egliseId" = $2`,
      [presenceId, jeu.egliseId],
    )
  ).rows[0] as { statut: string; enSalle: boolean };

const evenements = async (jeu: Jeu) =>
  (
    await sql(
      jeu,
      `SELECT type, "userId", detail FROM "EvenementPresence"
       WHERE "egliseId" = $1 ORDER BY "createdAt", id`,
      [jeu.egliseId],
    )
  ).rows as { type: string; userId: string; detail: Record<string, unknown> }[];

const actions = async (jeu: Jeu) =>
  (
    await sql(
      jeu,
      `SELECT action FROM "AuditLog" WHERE "egliseId" = $1 AND entite = 'Presence'
       ORDER BY "createdAt", id`,
      [jeu.egliseId],
    )
  ).rows.map((r: { action: string }) => r.action);

/** Moves the confirmation back in time (database clock). */
const vieillirConfirmation = (jeu: Jeu, presenceId: string, secondes: number) =>
  sql(
    jeu,
    `UPDATE "Presence" SET "enSalleLe" = "enSalleLe" - make_interval(secs => $3)
     WHERE id = $1 AND "egliseId" = $2`,
    [presenceId, jeu.egliseId, secondes],
  );

const vieillirCheckin = (jeu: Jeu, minutes: number) =>
  sql(
    jeu,
    `UPDATE "Presence" SET "checkinLe" = "checkinLe" - make_interval(mins => $2)
     WHERE "egliseId" = $1`,
    [jeu.egliseId, minutes],
  );

const toucher = (auteur: ContexteEglise, classe: ClasseDeSession, presenceId: string) =>
  dbA.$tx((tx) => confirmerParToucher(tx, auteur, classe, { presenceId }));

const annuler = (auteur: ContexteEglise, presenceId: string, corriger = false, motif?: string) =>
  dbA.$tx((tx) => annulerEnSalle(tx, auteur, classeA, corriger, { presenceId, motif }));

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
  // A second class in A, created before the opening: the session gets both classes.
  await sql(
    a,
    `INSERT INTO "Classe" (id, "egliseId", nom, "ageMinMois", "ageMaxMois", ordre)
     VALUES ('classe_a2', $1, '6–8 ans', 72, 107, 2)`,
    [a.egliseId],
  );
  await dbA.$tx((tx) => ouvrirSession(tx, contexteVerifie(a), a.sessionId));
  await clientEglise(base, b.egliseId).$tx((tx) =>
    ouvrirSession(tx, contexteVerifie(b), b.sessionId),
  );
  const ids = (
    await sql(
      a,
      `SELECT id, "classeId" FROM "SessionClasse" WHERE "egliseId" = $1 AND "sessionId" = $2`,
      [a.egliseId, a.sessionId],
    )
  ).rows as { id: string; classeId: string }[];
  classeA = (await classeDeSession(dbA, ids.find((l) => l.classeId === a.classeId)!.id))!;
  autreClasseA = (await classeDeSession(dbA, ids.find((l) => l.classeId === "classe_a2")!.id))!;
});

describe("confirmation de l'arrivée en salle", () => {
  it("par toucher : PRESENT → EN_SALLE, événement et audit dans la même transaction", async () => {
    const moniteur = await membre(a, "m1", ["MONITEUR"]);
    await affecter(a, classeA, moniteur);
    const { presences } = await famille(a, "f1", [a.classeId]);

    expect(await toucher(moniteur, classeA, presences[0]!)).toEqual({
      confirmes: ["Ayo"],
      dejaEnSalle: [],
    });
    expect(await statut(a, presences[0]!)).toEqual({ statut: "EN_SALLE", enSalle: true });
    expect(await evenements(a)).toEqual([
      {
        type: "en_salle",
        userId: "user_m1",
        detail: { statut: "EN_SALLE", classeId: a.classeId, mode: "toucher" },
      },
    ]);
    expect(await actions(a)).toEqual(["presence.en_salle"]);
  });

  it("un renfort affecté confirme, quel que soit son rôle ; un membre non affecté, non", async () => {
    const renfort = await membre(a, "renfort", ["ACCUEIL"]);
    const ailleurs = await membre(a, "ailleurs", ["MONITEUR"]);
    await affecter(a, classeA, renfort, true);
    await affecter(a, autreClasseA, ailleurs);
    const { presences } = await famille(a, "f1", [a.classeId, a.classeId]);

    await expect(toucher(ailleurs, classeA, presences[0]!)).rejects.toThrow(
      new SalleRefusee(
        "Seuls les membres affectés à cette classe confirment les arrivées. Rejoignez la classe d'abord.",
      ),
    );
    expect(await toucher(renfort, classeA, presences[1]!)).toMatchObject({ confirmes: ["Sèna"] });
    expect(await statut(a, presences[0]!)).toMatchObject({ statut: "PRESENT" });
  });

  it("refuse un enfant attendu dans une autre classe, sans rien écrire", async () => {
    const moniteur = await membre(a, "m1", ["MONITEUR"]);
    await affecter(a, classeA, moniteur);
    const { presences } = await famille(a, "f1", ["classe_a2"]);

    await expect(toucher(moniteur, classeA, presences[0]!)).rejects.toThrow(
      "Cet enfant n'est pas attendu dans cette classe. Vérifiez sa classe à l'accueil.",
    );
    expect(await statut(a, presences[0]!)).toMatchObject({ statut: "PRESENT" });
    expect(await evenements(a)).toEqual([]);
  });

  it("deux tablettes confirment le même enfant en même temps : un seul événement", async () => {
    const m1 = await membre(a, "m1", ["MONITEUR"]);
    const m2 = await membre(a, "m2", ["MONITEUR"]);
    await affecter(a, classeA, m1);
    await affecter(a, classeA, m2);
    const { presences } = await famille(a, "f1", [a.classeId]);

    const resultats = await Promise.all([
      toucher(m1, classeA, presences[0]!),
      toucher(m2, classeA, presences[0]!),
    ]);
    expect(resultats.map((r) => r.confirmes.length).sort()).toEqual([0, 1]);
    expect(resultats.map((r) => r.dejaEnSalle.length).sort()).toEqual([0, 1]);
    expect(await evenements(a)).toHaveLength(1);
    expect(await actions(a)).toEqual(["presence.en_salle"]);
  });

  it("par scan : une carte famille en attente confirme ses enfants de la classe, sans être activée", async () => {
    const moniteur = await membre(a, "m1", ["MONITEUR"]);
    await affecter(a, classeA, moniteur);
    const { familleId, presences } = await famille(a, "f1", [a.classeId, "classe_a2", a.classeId]);
    await sql(
      a,
      `INSERT INTO "CarteFamille" (id, "egliseId", "familleId", "tokenHash")
       VALUES ('carte_a', $1, $2, $3)`,
      [a.egliseId, familleId, empreinte(jetonCarte("A"))],
    );

    expect(
      await dbA.$tx((tx) =>
        confirmerParScan(tx, moniteur, aucunMoniteur, classeA, jetonCarte("A")),
      ),
    ).toEqual({ confirmes: ["Ayo", "Koffi"], dejaEnSalle: [] });
    // Sèna is expected in the other class: untouched.
    expect(await statut(a, presences[1]!)).toMatchObject({ statut: "PRESENT" });
    // Read only: the pending card stays pending (activation belongs to check-in and check-out).
    const carte = await sql(
      a,
      `SELECT "activeLe" FROM "CarteFamille" WHERE id = 'carte_a' AND "egliseId" = $1`,
      [a.egliseId],
    );
    expect(carte.rows).toEqual([{ activeLe: null }]);
    expect((await evenements(a)).map((e) => e.detail.mode)).toEqual(["scan", "scan"]);

    // Scanned again: nothing more to confirm.
    expect(
      await dbA.$tx((tx) =>
        confirmerParScan(tx, moniteur, aucunMoniteur, classeA, jetonCarte("A")),
      ),
    ).toEqual({ confirmes: [], dejaEnSalle: ["Ayo", "Koffi"] });
  });

  it("nomme les enfants confirmés du plus âgé au plus jeune, quel que soit l'ordre des lignes", async () => {
    const moniteur = await membre(a, "m1", ["MONITEUR"]);
    await affecter(a, classeA, moniteur);
    const { familleId } = await famille(a, "f1", [a.classeId, a.classeId, a.classeId]);
    await sql(
      a,
      `INSERT INTO "CarteFamille" (id, "egliseId", "familleId", "tokenHash", "activeLe")
       VALUES ('carte_o', $1, $2, $3, now())`,
      [a.egliseId, familleId, empreinte(jetonCarte("O"))],
    );
    // Sèna, inserted second, is the eldest; Koffi, inserted last, comes before Ayo.
    for (const [i, naissance] of [
      [0, "2021-05-02"],
      [1, "2018-01-10"],
      [2, "2020-07-20"],
    ] as const) {
      await sql(a, `UPDATE "Enfant" SET "dateNaissance" = $3 WHERE id = $1 AND "egliseId" = $2`, [
        `${familleId}_${i}`,
        a.egliseId,
        naissance,
      ]);
    }
    expect(
      await dbA.$tx((tx) =>
        confirmerParScan(tx, moniteur, aucunMoniteur, classeA, jetonCarte("O")),
      ),
    ).toEqual({ confirmes: ["Sèna", "Koffi", "Ayo"], dejaEnSalle: [] });
  });

  it("par scan : une carte enfant confirme cet enfant seul ; un badge et une carte inconnue sont refusés", async () => {
    const moniteur = await membre(a, "m1", ["MONITEUR"]);
    await affecter(a, classeA, moniteur);
    const { familleId, presences } = await famille(a, "f1", [a.classeId, a.classeId]);
    await sql(
      a,
      `INSERT INTO "CarteFamille" (id, "egliseId", "familleId", "enfantId", "tokenHash", "activeLe")
       VALUES ('carte_e', $1, $2, $3, $4, now())`,
      [a.egliseId, familleId, `${familleId}_1`, empreinte(jetonCarte("E"))],
    );
    const badge = "HKB1." + "B".repeat(22);
    await sql(
      a,
      `INSERT INTO "BadgeMoniteur" (id, "egliseId", "membreId", "tokenHash")
       VALUES ('badge_m1', $1, 'membre_m1', $2)`,
      [a.egliseId, empreinte(badge)],
    );
    const scanner = (jeton: string, verifier = aucunMoniteur) =>
      dbA.$tx((tx) => confirmerParScan(tx, moniteur, verifier, classeA, jeton));

    expect(await scanner(jetonCarte("E"))).toEqual({ confirmes: ["Sèna"], dejaEnSalle: [] });
    expect(await statut(a, presences[0]!)).toMatchObject({ statut: "PRESENT" });
    await expect(scanner(badge, async () => true)).rejects.toThrow(
      "C'est un badge moniteur : scannez la carte de l'enfant ou de la famille.",
    );
    await expect(scanner(jetonCarte("Z"))).rejects.toThrow(SalleRefusee);
  });

  it("refuse toute confirmation dans une session clôturée", async () => {
    const moniteur = await membre(a, "m1", ["MONITEUR"]);
    await affecter(a, classeA, moniteur);
    const { presences } = await famille(a, "f1", [a.classeId]);
    await expect(
      toucher(moniteur, { ...classeA, sessionOuverte: false }, presences[0]!),
    ).rejects.toThrow("La session n'est plus ouverte : rien ne peut être confirmé.");
  });
});

describe("annulation d'une confirmation", () => {
  it("son auteur l'annule dans la minute, sans motif : retour à PRESENT, événement et audit", async () => {
    const moniteur = await membre(a, "m1", ["MONITEUR"]);
    await affecter(a, classeA, moniteur);
    const { presences } = await famille(a, "f1", [a.classeId]);
    await toucher(moniteur, classeA, presences[0]!);

    expect(await annuler(moniteur, presences[0]!)).toEqual({ prenom: "Ayo" });
    expect(await statut(a, presences[0]!)).toEqual({ statut: "PRESENT", enSalle: false });
    expect((await evenements(a)).map((e) => [e.type, e.detail])).toEqual([
      ["en_salle", { statut: "EN_SALLE", classeId: a.classeId, mode: "toucher" }],
      ["en_salle_annulee", { statut: "PRESENT", par: "auteur" }],
    ]);
    expect(await actions(a)).toEqual(["presence.en_salle", "presence.en_salle_annulee"]);
    // Confirmed again later: a new confirmation, a new minute.
    await toucher(moniteur, classeA, presences[0]!);
    expect(await statut(a, presences[0]!)).toMatchObject({ statut: "EN_SALLE" });
  });

  it("après la minute (horloge de la base), ou pour la confirmation d'un autre, seul le responsable corrige, avec un motif", async () => {
    const m1 = await membre(a, "m1", ["MONITEUR"]);
    const m2 = await membre(a, "m2", ["MONITEUR"]);
    const responsable = await membre(a, "resp", ["RESPONSABLE"]);
    await affecter(a, classeA, m1);
    await affecter(a, classeA, m2);
    const { presences } = await famille(a, "f1", [a.classeId]);
    await toucher(m1, classeA, presences[0]!);

    // Within the minute, another member cannot undo m1's confirmation.
    await expect(annuler(m2, presences[0]!)).rejects.toThrow(
      "Le délai d'une minute est passé : seul le responsable peut corriger cette arrivée.",
    );
    await vieillirConfirmation(a, presences[0]!, 61);
    await expect(annuler(m1, presences[0]!)).rejects.toThrow(
      "Le délai d'une minute est passé : seul le responsable peut corriger cette arrivée.",
    );
    await expect(annuler(responsable, presences[0]!, true)).rejects.toThrow(
      "Indiquez le motif de la correction, puis recommencez.",
    );
    expect(await statut(a, presences[0]!)).toMatchObject({ statut: "EN_SALLE" });

    await annuler(responsable, presences[0]!, true, "Touché par erreur, Ayo est aux toilettes");
    expect(await statut(a, presences[0]!)).toEqual({ statut: "PRESENT", enSalle: false });
    expect((await evenements(a)).at(-1)).toEqual({
      type: "en_salle_annulee",
      userId: "user_resp",
      detail: {
        statut: "PRESENT",
        par: "responsable",
        motif: "Touché par erreur, Ayo est aux toilettes",
      },
    });
    await expect(annuler(responsable, presences[0]!, true, "Encore")).rejects.toThrow(
      "Ayo n'est pas en salle : il n'y a rien à annuler.",
    );
  });

  it("59 secondes après, son auteur annule encore", async () => {
    const moniteur = await membre(a, "m1", ["MONITEUR"]);
    await affecter(a, classeA, moniteur);
    const { presences } = await famille(a, "f1", [a.classeId]);
    await toucher(moniteur, classeA, presences[0]!);
    await vieillirConfirmation(a, presences[0]!, 59);
    await expect(annuler(moniteur, presences[0]!)).resolves.toEqual({ prenom: "Ayo" });
  });
});

describe("liste de la classe et alerte « non arrivé en salle »", () => {
  it("à confirmer en haut, en salle en dessous, alertes médicales, retard et bouton Annuler", async () => {
    const m1 = await membre(a, "m1", ["MONITEUR"]);
    const m2 = await membre(a, "m2", ["MONITEUR"]);
    await affecter(a, classeA, m1);
    await affecter(a, classeA, m2);
    const { presences } = await famille(a, "f1", [a.classeId, a.classeId]);
    await vieillirCheckin(a, 11);
    await toucher(m1, classeA, presences[1]!);

    const pour = (auteur: ContexteEglise) => listeDeClasse(dbA, classeA, auteur.userId, 10);
    expect(await pour(m1)).toEqual([
      expect.objectContaining({
        prenom: "Ayo",
        statut: "PRESENT",
        enRetard: true,
        annulable: false,
        alertes: ["Allergie alimentaire", "arachides"],
        attenteMinutes: 11,
      }),
      expect.objectContaining({ prenom: "Sèna", statut: "EN_SALLE", annulable: true }),
    ]);
    expect((await pour(m2))[1]).toMatchObject({ prenom: "Sèna", annulable: false });
    expect((await listeDeClasse(dbA, classeA, m1.userId, 15))[0]).toMatchObject({
      enRetard: false,
    });
  });

  it("l'alerte vient après le délai réglé, et part dès la confirmation", async () => {
    const moniteur = await membre(a, "m1", ["MONITEUR"]);
    await affecter(a, classeA, moniteur);
    const { presences } = await famille(a, "f1", [a.classeId]);

    expect(await alertesNonArrives(dbA, 10)).toEqual([]);
    await vieillirCheckin(a, 11);
    expect(await alertesNonArrives(dbA, 10)).toEqual([
      {
        presenceId: presences[0],
        prenom: "Ayo",
        matricule: "HK-f10",
        classe: "3–5 ans",
        minutes: 11,
      },
    ]);
    await toucher(moniteur, classeA, presences[0]!);
    expect(await alertesNonArrives(dbA, 10)).toEqual([]);
  });
});

describe("enfants sans alerte médicale", () => {
  it("un enfant créé sans alerte a une liste vide : la liste de la classe s'affiche", async () => {
    await sql(
      a,
      `INSERT INTO "Famille" (id, "egliseId", nom, "finaliseeLe", "updatedAt")
       VALUES ('famille_sans', $1, 'Sans', now(), now())`,
      [a.egliseId],
    );
    // No "alertes" column in the INSERT: the database default applies.
    await sql(
      a,
      `INSERT INTO "Enfant" (id, "egliseId", matricule, "familleId", prenom, nom, "dateNaissance", "updatedAt")
       VALUES ('enfant_sans', $1, 'HK-9001', 'famille_sans', 'Mawuli', 'Sans', '2021-05-02', now())`,
      [a.egliseId],
    );
    await sql(
      a,
      `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut,
                               "codeRetrait", "checkinPar")
       VALUES ('presence_sans', $1, $2, 'enfant_sans', $3, 'PRESENT', 'K7MP', 'user_accueil')`,
      [a.egliseId, a.sessionId, a.classeId],
    );

    expect(await listeDeClasse(dbA, classeA, "user_test", 10)).toEqual([
      expect.objectContaining({ prenom: "Mawuli", alertes: [] }),
    ]);
  });

  it("la base refuse NULL dans Enfant.alertes, à l'insertion comme à la mise à jour", async () => {
    await sql(
      a,
      `INSERT INTO "Famille" (id, "egliseId", nom, "updatedAt") VALUES ('famille_nul', $1, 'Nul', now())`,
      [a.egliseId],
    );
    expect(
      await codeErreur(
        sql(
          a,
          `INSERT INTO "Enfant" (id, "egliseId", "familleId", prenom, nom, "dateNaissance", alertes, "updatedAt")
           VALUES ('enfant_nul', $1, 'famille_nul', 'Nul', 'Nul', '2021-05-02', NULL, now())`,
          [a.egliseId],
        ),
      ),
    ).toBe("23502");
    expect(
      await codeErreur(
        sql(a, `UPDATE "Enfant" SET alertes = NULL WHERE id = $1 AND "egliseId" = $2`, [
          a.enfantId,
          a.egliseId,
        ]),
      ),
    ).toBe("23502");
  });
});

describe("isolation A/B", () => {
  it("A ne voit ni ne confirme une classe ou un enfant de B, et ses alertes ignorent B", async () => {
    const moniteur = await membre(a, "m1", ["MONITEUR"]);
    await affecter(a, classeA, moniteur);
    const { presences } = await famille(b, "fb", [b.classeId]);
    await vieillirCheckin(b, 30);
    const classeB = (
      await sql(b, `SELECT id FROM "SessionClasse" WHERE "egliseId" = $1 AND "sessionId" = $2`, [
        b.egliseId,
        b.sessionId,
      ])
    ).rows[0] as { id: string };

    expect(await classeDeSession(dbA, classeB.id)).toBeNull();
    await expect(toucher(moniteur, classeA, presences[0]!)).rejects.toThrow(SalleRefusee);
    expect(await statut(b, presences[0]!)).toMatchObject({ statut: "PRESENT" });
    expect(await alertesNonArrives(dbA, 10)).toEqual([]);
    expect(
      await enEglise(proprietaire, b.egliseId, () =>
        compterDansEglise(proprietaire, "EvenementPresence", b.egliseId),
      ),
    ).toBe(0);
  });
});

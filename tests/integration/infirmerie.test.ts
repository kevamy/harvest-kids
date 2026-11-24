/**
 * Lot 3, step 3: infirmerie (cahier §7.7, RG-07, ADR 0019; decisions of 2026-11-24). Sending,
 * receiving and sending back write an event and an audit entry in one transaction; a child
 * en route past the church's delay is "not arrived" (database clock: time passes by moving
 * the stored dates back); back to class means PRESENT again, with the "not yet in class"
 * delay counted from the return; the class door refuses a child at the infirmerie, the
 * reception desk hands them over. Church B never reaches a child of church A.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { clientEglise, type ClientEglise } from "@/lib/tenant";
import { CheckoutRefuse, preparerCheckout, validerCheckout } from "@/server/checkout";
import {
  InfirmerieRefusee,
  envoyerInfirmerie,
  listeInfirmerie,
  recevoirInfirmerie,
  renvoyerEnClasse,
} from "@/server/infirmerie";
import { creerClientPlateforme } from "@/server/plateforme/db";
import { alertesNonArrives, classeDeSession, listeDeClasse } from "@/server/salle";
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
const aucunMoniteur = async () => false;
const tous = async () => true;

const sql = (jeu: Jeu, requete: string, valeurs: unknown[] = []) =>
  enEglise(proprietaire, jeu.egliseId, () => proprietaire.query(requete, valeurs));

/** Open session, its class, Ayo checked in with code K7RM, his mother authorised. */
async function preparer(jeu: Jeu, statut: "PRESENT" | "EN_SALLE" = "PRESENT") {
  await sql(jeu, `UPDATE "Session" SET statut = 'OUVERTE' WHERE id = $1 AND "egliseId" = $2`, [
    jeu.sessionId,
    jeu.egliseId,
  ]);
  await sql(
    jeu,
    `INSERT INTO "SessionClasse" (id, "egliseId", "sessionId", "classeId", "ouverteLe")
     VALUES ($1, $2, $3, $4, now())`,
    [`sc_${jeu.egliseId}`, jeu.egliseId, jeu.sessionId, jeu.classeId],
  );
  await sql(
    jeu,
    `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut, "codeRetrait", "checkinPar", "enSalleLe")
     VALUES ($1, $2, $3, $4, $5, $6, 'K7RM', 'user_accueil', CASE WHEN $7 THEN now() END)`,
    [
      `presence_${jeu.egliseId}`,
      jeu.egliseId,
      jeu.sessionId,
      jeu.enfantId,
      jeu.classeId,
      statut,
      statut === "EN_SALLE",
    ],
  );
  await sql(
    jeu,
    `INSERT INTO "PersonneAutorisee" (id, "egliseId", "familleId", prenom, nom, lien, "photoKey")
     VALUES ($1, $2, $3, 'Afi', 'Mensah', 'Mère', 'eglises/x/photos/mere.webp')`,
    [`pa_${jeu.egliseId}`, jeu.egliseId, jeu.familleId],
  );
  return `presence_${jeu.egliseId}`;
}

const envoyer = (db: ClientEglise, presenceId: string, valide = tous) =>
  db.$tx((tx) =>
    envoyerInfirmerie(
      tx,
      auteur,
      { presenceId, accompagnantUserId: "user_moniteur", motif: "Fièvre" },
      valide,
    ),
  );

async function etat(jeu: Jeu, presenceId: string) {
  const { rows } = await sql(
    jeu,
    `SELECT statut::text AS statut, "infirmerieLe" IS NOT NULL AS envoye,
            "infirmerieRecueLe" IS NOT NULL AS recu, "retourInfirmerieLe" IS NOT NULL AS retour,
            "enSalleLe" IS NOT NULL AS "enSalle"
     FROM "Presence" WHERE id = $1 AND "egliseId" = $2`,
    [presenceId, jeu.egliseId],
  );
  return rows[0];
}

async function traces(jeu: Jeu, presenceId: string) {
  const { rows } = await sql(
    jeu,
    `SELECT ev.type, ev.detail, (SELECT count(*)::int FROM "AuditLog" l
              WHERE l."egliseId" = ev."egliseId" AND l."entiteId" = ev."presenceId"
                AND l.action = 'presence.' || ev.type) AS audits
     FROM "EvenementPresence" ev
     WHERE ev."egliseId" = $1 AND ev."presenceId" = $2 ORDER BY ev."createdAt", ev.id`,
    [jeu.egliseId, presenceId],
  );
  return rows;
}

/** Moves the sending time back: the child has been en route for that long. */
const reculerEnvoi = (jeu: Jeu, presenceId: string, minutes: number) =>
  sql(
    jeu,
    `UPDATE "Presence" SET "infirmerieLe" = "infirmerieLe" - make_interval(mins => $3)
     WHERE id = $1 AND "egliseId" = $2`,
    [presenceId, jeu.egliseId, minutes],
  );

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

describe("envoi, réception, retour", () => {
  it("un enfant en salle part en route, est reçu, puis renvoyé : PRESENT, à confirmer par la classe", async () => {
    const presenceId = await preparer(a, "EN_SALLE");

    expect(await envoyer(dbA, presenceId)).toEqual({ prenom: "Prénom" });
    expect(await etat(a, presenceId)).toEqual({
      statut: "INFIRMERIE",
      envoye: true,
      recu: false,
      retour: false,
      enSalle: true,
    });
    await dbA.$tx((tx) => recevoirInfirmerie(tx, auteur, { presenceId }));
    expect(await etat(a, presenceId)).toMatchObject({ statut: "INFIRMERIE", recu: true });
    await dbA.$tx((tx) => renvoyerEnClasse(tx, auteur, { presenceId }));
    expect(await etat(a, presenceId)).toEqual({
      statut: "PRESENT",
      envoye: false,
      recu: false,
      retour: true,
      enSalle: false,
    });

    expect(await traces(a, presenceId)).toEqual([
      {
        type: "infirmerie",
        detail: {
          statut: "INFIRMERIE",
          depuis: "EN_SALLE",
          accompagnant: "user_moniteur",
          motif: "Fièvre",
        },
        audits: 1,
      },
      { type: "infirmerie_recue", detail: { statut: "INFIRMERIE" }, audits: 1 },
      { type: "infirmerie_retour", detail: { statut: "PRESENT", recu: true }, audits: 1 },
    ]);
  });

  it("refuse un accompagnant hors de l'église, un second envoi, une seconde réception, une session close", async () => {
    const presenceId = await preparer(a);
    await expect(envoyer(dbA, presenceId, async () => false)).rejects.toThrow(
      "Choisissez qui accompagne",
    );
    await expect(
      dbA.$tx((tx) =>
        envoyerInfirmerie(
          tx,
          auteur,
          { presenceId, accompagnantUserId: "user_moniteur", motif: " " },
          tous,
        ),
      ),
    ).rejects.toThrow("Indiquez le motif");
    await envoyer(dbA, presenceId);
    await expect(envoyer(dbA, presenceId)).rejects.toThrow("déjà à l'infirmerie");
    await dbA.$tx((tx) => recevoirInfirmerie(tx, auteur, { presenceId }));
    await expect(dbA.$tx((tx) => recevoirInfirmerie(tx, auteur, { presenceId }))).rejects.toThrow(
      "déjà reçu",
    );
    await sql(a, `UPDATE "Session" SET statut = 'CLOTUREE' WHERE id = $1 AND "egliseId" = $2`, [
      a.sessionId,
      a.egliseId,
    ]);
    await expect(dbA.$tx((tx) => renvoyerEnClasse(tx, auteur, { presenceId }))).rejects.toThrow(
      "n'est plus ouverte",
    );
    // Only the first sending and the reception were written.
    expect((await traces(a, presenceId)).map((t) => t.type)).toEqual([
      "infirmerie",
      "infirmerie_recue",
    ]);
  });

  it("isolation A/B : B n'envoie, ne reçoit, ne renvoie ni ne voit un enfant de A", async () => {
    const presenceA = await preparer(a);
    await expect(envoyer(dbB, presenceA)).rejects.toThrow(InfirmerieRefusee);
    await envoyer(dbA, presenceA);
    await expect(
      dbB.$tx((tx) => recevoirInfirmerie(tx, auteur, { presenceId: presenceA })),
    ).rejects.toThrow(InfirmerieRefusee);
    await expect(
      dbB.$tx((tx) => renvoyerEnClasse(tx, auteur, { presenceId: presenceA })),
    ).rejects.toThrow(InfirmerieRefusee);
    expect(await listeInfirmerie(dbB, 5)).toEqual([]);
    expect((await listeInfirmerie(dbA, 5)).map((e) => e.presenceId)).toEqual([presenceA]);
  });
});

describe("alertes", () => {
  it("« pas arrivé à l'infirmerie » au-delà du délai de l'église, jusqu'à la réception", async () => {
    const presenceId = await preparer(a);
    await envoyer(dbA, presenceId);
    const ligne = async (delai: number) => (await listeInfirmerie(dbA, delai))[0]!;

    expect(await ligne(5)).toMatchObject({
      enRoute: true,
      nonArrive: false,
      motif: "Fièvre",
      accompagnantUserId: "user_moniteur",
    });
    await reculerEnvoi(a, presenceId, 6);
    expect(await ligne(5)).toMatchObject({ enRoute: true, nonArrive: true, depuisMinutes: 6 });
    // The church's delay decides.
    expect(await ligne(10)).toMatchObject({ nonArrive: false });
    await dbA.$tx((tx) => recevoirInfirmerie(tx, auteur, { presenceId }));
    expect(await ligne(5)).toMatchObject({ enRoute: false, nonArrive: false });
  });

  it("après le retour, l'alerte « pas encore en salle » part de l'heure du retour", async () => {
    const presenceId = await preparer(a);
    // Checked in long ago: without the return, the child would be alerted at once.
    await sql(
      a,
      `UPDATE "Presence" SET "checkinLe" = "checkinLe" - interval '1 hour'
       WHERE id = $1 AND "egliseId" = $2`,
      [presenceId, a.egliseId],
    );
    await envoyer(dbA, presenceId);
    await dbA.$tx((tx) => renvoyerEnClasse(tx, auteur, { presenceId }));
    expect(await alertesNonArrives(dbA, 10)).toEqual([]);
    const classe = (await classeDeSession(dbA, `sc_${a.egliseId}`))!;
    expect((await listeDeClasse(dbA, classe, "user_test", 10))[0]).toMatchObject({
      statut: "PRESENT",
      retourInfirmerie: true,
      enRetard: false,
      infirmerie: null,
    });

    await sql(
      a,
      `UPDATE "Presence" SET "retourInfirmerieLe" = "retourInfirmerieLe" - interval '11 minutes'
       WHERE id = $1 AND "egliseId" = $2`,
      [presenceId, a.egliseId],
    );
    expect(await alertesNonArrives(dbA, 10)).toEqual([
      expect.objectContaining({ presenceId, minutes: 11, retourInfirmerie: true }),
    ]);
  });

  it("la liste de classe donne l'infirmerie en tête, avec sa durée", async () => {
    const presenceId = await preparer(a);
    await envoyer(dbA, presenceId);
    await reculerEnvoi(a, presenceId, 3);
    const classe = (await classeDeSession(dbA, `sc_${a.egliseId}`))!;
    expect((await listeDeClasse(dbA, classe, "user_test", 10))[0]).toMatchObject({
      statut: "INFIRMERIE",
      infirmerie: { depuisMinutes: 3, enRoute: true },
    });
  });
});

describe("check-out d'un enfant à l'infirmerie", () => {
  const saisie = (presenceId: string) => ({
    sessionId: a.sessionId,
    familleId: a.familleId,
    code: "K7RM",
    personneAutoriseeId: `pa_${a.egliseId}`,
    presenceIds: [presenceId],
  });

  it("refusé à la porte de la classe, sans case à cocher ; remis à l'accueil, qui l'efface de l'infirmerie", async () => {
    const presenceId = await preparer(a);
    await envoyer(dbA, presenceId);

    const enSalle = await preparerCheckout(
      dbA,
      aucunMoniteur,
      { sessionId: a.sessionId, code: "K7RM" },
      { classeId: a.classeId },
    );
    expect(enSalle.enfants).toEqual([
      expect.objectContaining({
        statut: "INFIRMERIE",
        lieu: "Infirmerie",
        remettable: false,
        coche: false,
      }),
    ]);
    await expect(
      dbA.$tx((tx) =>
        validerCheckout(tx, auteur, aucunMoniteur, saisie(presenceId), undefined, {
          classeId: a.classeId,
        }),
      ),
    ).rejects.toThrow(
      new CheckoutRefuse("Prénom est à l'infirmerie : accompagnez le parent à l'accueil."),
    );
    expect(await etat(a, presenceId)).toMatchObject({ statut: "INFIRMERIE" });

    const accueil = await preparerCheckout(dbA, aucunMoniteur, {
      sessionId: a.sessionId,
      code: "K7RM",
    });
    expect(accueil.enfants[0]).toMatchObject({ remettable: true, coche: true });
    await dbA.$tx((tx) => validerCheckout(tx, auteur, aucunMoniteur, saisie(presenceId)));
    expect(await etat(a, presenceId)).toMatchObject({
      statut: "RECUPERE",
      envoye: false,
      recu: false,
    });
    expect(await listeInfirmerie(dbA, 5)).toEqual([]);
  });
});

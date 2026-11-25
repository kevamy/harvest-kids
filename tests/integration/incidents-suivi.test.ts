/**
 * Lot 3, step 6: incidents declared from a child's card (cahier §7.9), their notes (append
 * only) and their closure (once). The declaration is attached to the child and the session
 * of the presence, with an event and an audit entry. Church B neither declares on, nor adds
 * a note to, nor closes, nor sees an incident of church A.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { clientEglise, type ClientEglise } from "@/lib/tenant";
import {
  IncidentRefuse,
  ajouterNoteIncident,
  cloturerIncident,
  declarerIncident,
  detailIncident,
  incidentsDesSessionsOuvertes,
} from "@/server/incidents";
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

const sql = (jeu: Jeu, requete: string, valeurs: unknown[] = []) =>
  enEglise(proprietaire, jeu.egliseId, () => proprietaire.query(requete, valeurs));

async function presenceOuverte(jeu: Jeu) {
  await sql(jeu, `UPDATE "Session" SET statut = 'OUVERTE' WHERE id = $1 AND "egliseId" = $2`, [
    jeu.sessionId,
    jeu.egliseId,
  ]);
  await sql(
    jeu,
    `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut, "codeRetrait", "checkinPar")
     VALUES ($1, $2, $3, $4, $5, 'EN_SALLE', 'K7RM', 'u')`,
    [`presence_${jeu.egliseId}`, jeu.egliseId, jeu.sessionId, jeu.enfantId, jeu.classeId],
  );
  return `presence_${jeu.egliseId}`;
}

const declarer = (db: ClientEglise, presenceId: string, type = "BLESSURE") =>
  db.$tx((tx) =>
    declarerIncident(tx, auteur, {
      presenceId,
      type,
      description: "Chute dans la cour, genou écorché",
      personnes: "Moniteur 2",
      mesures: "Désinfecté, pansement",
    }),
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

describe("déclaration depuis la fiche", () => {
  it("rattache l'incident à l'enfant et à la session, avec un événement et un audit", async () => {
    const presenceId = await presenceOuverte(a);
    const { incidentId } = await declarer(dbA, presenceId);
    const detail = await detailIncident(dbA, incidentId);
    expect(detail).toMatchObject({
      type: "BLESSURE",
      description: "Chute dans la cour, genou écorché",
      personnes: "Moniteur 2",
      mesures: "Désinfecté, pansement",
      declarePar: "user_test",
      clos: false,
      enfant: { prenom: "Prénom", matricule: "HK-0001" },
      notes: [],
    });
    const { rows } = await sql(
      a,
      `SELECT "sessionId", "enfantId",
              (SELECT count(*)::int FROM "EvenementPresence" ev
                WHERE ev."egliseId" = i."egliseId" AND ev."presenceId" = $2 AND ev.type = 'incident') AS evenements,
              (SELECT count(*)::int FROM "AuditLog" l
                WHERE l."egliseId" = i."egliseId" AND l."entiteId" = i.id AND l.action = 'incident.cree') AS audits
       FROM "Incident" i WHERE i.id = $1 AND i."egliseId" = $3`,
      [incidentId, presenceId, a.egliseId],
    );
    expect(rows).toEqual([
      { sessionId: a.sessionId, enfantId: a.enfantId, evenements: 1, audits: 1 },
    ]);
  });

  it("refuse le type réservé au retrait exceptionnel, une description vide, une présence d'une autre église", async () => {
    const presenceA = await presenceOuverte(a);
    await expect(declarer(dbA, presenceA, "RETRAIT_NON_AUTORISE")).rejects.toThrow(
      "Choisissez le type",
    );
    await expect(
      dbA.$tx((tx) =>
        declarerIncident(tx, auteur, { presenceId: presenceA, type: "MALAISE", description: " " }),
      ),
    ).rejects.toThrow("Décrivez");
    await expect(declarer(dbB, presenceA)).rejects.toThrow(IncidentRefuse);
  });
});

describe("notes et clôture", () => {
  it("les notes s'ajoutent dans l'ordre, avant comme après la clôture ; la clôture se pose une fois", async () => {
    const { incidentId } = await declarer(dbA, await presenceOuverte(a));
    const noter = (texte: string) =>
      dbA.$tx((tx) => ajouterNoteIncident(tx, auteur, { incidentId, texte }));
    await noter("Parents prévenus à la sortie.");
    await dbA.$tx((tx) => cloturerIncident(tx, auteur, incidentId));
    await expect(dbA.$tx((tx) => cloturerIncident(tx, auteur, incidentId))).rejects.toThrow(
      "déjà clos",
    );
    await noter("Certificat médical reçu.");

    const detail = (await detailIncident(dbA, incidentId))!;
    expect(detail).toMatchObject({ clos: true, cloturePar: "user_test" });
    expect(detail.clotureLe).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    expect(detail.notes.map((n) => [n.texte, n.auteur])).toEqual([
      ["Parents prévenus à la sortie.", "user_test"],
      ["Certificat médical reçu.", "user_test"],
    ]);
    // The declared content is untouched.
    expect(detail.description).toBe("Chute dans la cour, genou écorché");
  });

  it("isolation A/B : B n'ajoute pas de note, ne clôt pas et ne voit pas un incident de A", async () => {
    const { incidentId } = await declarer(dbA, await presenceOuverte(a));
    await expect(
      dbB.$tx((tx) => ajouterNoteIncident(tx, auteur, { incidentId, texte: "Écrite depuis B" })),
    ).rejects.toThrow(IncidentRefuse);
    await expect(dbB.$tx((tx) => cloturerIncident(tx, auteur, incidentId))).rejects.toThrow(
      IncidentRefuse,
    );
    expect(await detailIncident(dbB, incidentId)).toBeNull();
    expect(await incidentsDesSessionsOuvertes(dbB)).toEqual([]);
    expect((await detailIncident(dbA, incidentId))!).toMatchObject({ clos: false, notes: [] });
  });
});

describe("tableau du responsable", () => {
  it("liste les incidents des sessions ouvertes seulement", async () => {
    const { incidentId } = await declarer(dbA, await presenceOuverte(a));
    expect(await incidentsDesSessionsOuvertes(dbA)).toEqual([
      expect.objectContaining({ id: incidentId, type: "BLESSURE", prenom: "Prénom", clos: false }),
    ]);
    await sql(a, `UPDATE "Session" SET statut = 'CLOTUREE' WHERE id = $1 AND "egliseId" = $2`, [
      a.sessionId,
      a.egliseId,
    ]);
    expect(await incidentsDesSessionsOuvertes(dbA)).toEqual([]);
  });
});

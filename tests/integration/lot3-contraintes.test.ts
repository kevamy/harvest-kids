/**
 * Lot 3 schema rules enforced by the database (migration lot3_infirmerie_appels), as the
 * application role: infirmerie columns of a presence, parent calls (one open per presence,
 * resolution set once), the phone call log (append only, result set once), incidents (content
 * frozen once declared, closure set once, notes append only and isolated per church), paired
 * call screens (never deleted, pairing and revocation final).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type Client,
  type Jeu,
  codeErreur,
  connecter,
  creerEglise,
  enEglise,
  viderBase,
} from "./support/db";

let app: Client;
let proprietaire: Client;
let a: Jeu;
let b: Jeu;

/** Runs one statement as the application in church A; returns its error code. */
const dansA = (sql: string, valeurs: unknown[] = []) =>
  codeErreur(enEglise(app, a.egliseId, () => app.query(sql, valeurs)));

beforeAll(async () => {
  app = await connecter("app");
  proprietaire = await connecter("proprietaire");
});

afterAll(async () => {
  await app?.end();
  await proprietaire?.end();
});

beforeEach(async () => {
  await viderBase(proprietaire);
  a = await creerEglise(proprietaire, "a");
  b = await creerEglise(proprietaire, "b");
  await enEglise(proprietaire, a.egliseId, async () => {
    await proprietaire.query(
      `INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut, "codeRetrait", "checkinPar")
       VALUES ('p_a', $1, $2, $3, $4, 'PRESENT', 'K7RM', 'user_test')`,
      [a.egliseId, a.sessionId, a.enfantId, a.classeId],
    );
    await proprietaire.query(
      `INSERT INTO "Incident" (id, "egliseId", "sessionId", "enfantId", type, description, "declarePar")
       VALUES ('incident_a', $1, $2, $3, 'BLESSURE', 'Genou écorché dans la cour', 'user_test')`,
      [a.egliseId, a.sessionId, a.enfantId],
    );
  });
});

describe("présence à l'infirmerie", () => {
  it("l'heure d'envoi existe si et seulement si le statut est INFIRMERIE ; la réception suppose un envoi", async () => {
    // 23514: check_violation.
    expect(await dansA(`UPDATE "Presence" SET statut = 'INFIRMERIE' WHERE id = 'p_a'`)).toBe(
      "23514",
    );
    expect(await dansA(`UPDATE "Presence" SET "infirmerieLe" = now() WHERE id = 'p_a'`)).toBe(
      "23514",
    );
    expect(await dansA(`UPDATE "Presence" SET "infirmerieRecueLe" = now() WHERE id = 'p_a'`)).toBe(
      "23514",
    );
    expect(
      await dansA(
        `UPDATE "Presence" SET statut = 'INFIRMERIE', "infirmerieLe" = now() WHERE id = 'p_a'`,
      ),
    ).toBeUndefined();
    expect(
      await dansA(`UPDATE "Presence" SET "infirmerieRecueLe" = now() WHERE id = 'p_a'`),
    ).toBeUndefined();
    // Back to class: both cleared together with the status.
    expect(
      await dansA(
        `UPDATE "Presence" SET statut = 'PRESENT', "infirmerieLe" = NULL, "infirmerieRecueLe" = NULL,
           "retourInfirmerieLe" = now() WHERE id = 'p_a'`,
      ),
    ).toBeUndefined();
  });
});

describe("appels des parents", () => {
  const appeler = (id: string, motif = "pleurs", lieu = "Accueil enfants") =>
    dansA(
      `INSERT INTO "Appel" (id, "egliseId", "presenceId", motif, lieu, "creePar")
       VALUES ($1, $2, 'p_a', $3, $4, 'user_test')`,
      [id, a.egliseId, motif, lieu],
    );

  it("motif dans la liste, lieu non vide, un seul appel ouvert par présence", async () => {
    expect(await appeler("appel_x", "faim")).toBe("23514");
    expect(await appeler("appel_x", "pleurs", "  ")).toBe("23514");
    expect(await appeler("appel_1")).toBeUndefined();
    // 23505: unique_violation (Appel_un_ouvert_par_presence).
    expect(await appeler("appel_2", "soins")).toBe("23505");
  });

  it("seule la résolution se pose, complète et une seule fois ; ni modification ni suppression", async () => {
    await appeler("appel_1");
    // Incomplete resolution.
    expect(await dansA(`UPDATE "Appel" SET "resoluLe" = now() WHERE id = 'appel_1'`)).toBe("23514");
    expect(
      await dansA(
        `UPDATE "Appel" SET "resoluLe" = now(), resolution = 'oublie', "resoluPar" = 'user_test'
         WHERE id = 'appel_1'`,
      ),
    ).toBe("23514");
    // 42501: insufficient_privilege (column privileges).
    expect(await dansA(`UPDATE "Appel" SET motif = 'soins' WHERE id = 'appel_1'`)).toBe("42501");
    expect(await dansA(`DELETE FROM "Appel" WHERE id = 'appel_1'`)).toBe("42501");

    const resoudre = `UPDATE "Appel" SET "resoluLe" = now(), resolution = $1, "resoluPar" = 'user_test'
                      WHERE id = 'appel_1'`;
    expect(await dansA(resoudre, ["parent_arrive"])).toBeUndefined();
    // Set once: the trigger refuses a second resolution.
    expect(await dansA(resoudre, ["annule"])).toBe("23514");
    // Resolved, the presence can be called again.
    expect(await appeler("appel_2", "change")).toBeUndefined();
  });

  it("le propriétaire non plus ne modifie pas le contenu d'un appel (déclencheur)", async () => {
    await appeler("appel_1");
    expect(
      await codeErreur(
        enEglise(proprietaire, a.egliseId, () =>
          proprietaire.query(
            `UPDATE "Appel" SET lieu = 'Infirmerie' WHERE id = 'appel_1' AND "egliseId" = $1`,
            [a.egliseId],
          ),
        ),
      ),
    ).toBe("23514");
  });
});

describe("journal des appels téléphoniques", () => {
  const journaliser = (id: string, numero = "+2290197451233", canal = "tel") =>
    dansA(
      `INSERT INTO "AppelTelephonique" (id, "egliseId", "presenceId", "enfantId", numero, canal, "userId")
       VALUES ($1, $2, 'p_a', $3, $4, $5, 'user_test')`,
      [id, a.egliseId, a.enfantId, numero, canal],
    );

  it("canal dans la liste, numéro au format E.164", async () => {
    expect(await journaliser("tel_x", "+2290197451233", "sms")).toBe("23514");
    for (const numero of ["0197451233", "+0197451233", "+229 01 97 45 12 33", "+22901"]) {
      expect(await journaliser("tel_x", numero), numero).toBe("23514");
    }
    expect(await journaliser("tel_1")).toBeUndefined();
    expect(await journaliser("tel_2", "+2290197451233", "whatsapp")).toBeUndefined();
  });

  it("en ajout seul : le résultat se note une fois, avec son heure ; rien d'autre ne change", async () => {
    await journaliser("tel_1");
    expect(
      await dansA(`UPDATE "AppelTelephonique" SET resultat = 'joint' WHERE id = 'tel_1'`),
    ).toBe("23514");
    expect(
      await dansA(
        `UPDATE "AppelTelephonique" SET resultat = 'occupe', "resultatLe" = now() WHERE id = 'tel_1'`,
      ),
    ).toBe("23514");
    expect(
      await dansA(`UPDATE "AppelTelephonique" SET numero = '+2290197000000' WHERE id = 'tel_1'`),
    ).toBe("42501");
    expect(await dansA(`DELETE FROM "AppelTelephonique" WHERE id = 'tel_1'`)).toBe("42501");

    const noter = `UPDATE "AppelTelephonique" SET resultat = $1, "resultatLe" = now() WHERE id = 'tel_1'`;
    expect(await dansA(noter, ["pas_de_reponse"])).toBeUndefined();
    expect(await dansA(noter, ["joint"])).toBe("23514");
  });
});

describe("incidents et notes", () => {
  it("le contenu d'un incident déclaré ne change plus ; seule la clôture se pose, complète et une fois", async () => {
    for (const sql of [
      `UPDATE "Incident" SET description = 'Autre récit' WHERE id = 'incident_a'`,
      `UPDATE "Incident" SET mesures = 'Glace' WHERE id = 'incident_a'`,
      `UPDATE "Incident" SET type = 'AUTRE' WHERE id = 'incident_a'`,
      `DELETE FROM "Incident" WHERE id = 'incident_a'`,
    ]) {
      expect(await dansA(sql), sql).toBe("42501");
    }
    expect(await dansA(`UPDATE "Incident" SET "clotureLe" = now() WHERE id = 'incident_a'`)).toBe(
      "23514",
    );
    const clore = `UPDATE "Incident" SET "clotureLe" = now(), "cloturePar" = $1 WHERE id = 'incident_a'`;
    expect(await dansA(clore, ["user_resp"])).toBeUndefined();
    expect(await dansA(clore, ["user_admin"])).toBe("23514");
    // The owner is held by the trigger too.
    expect(
      await codeErreur(
        enEglise(proprietaire, a.egliseId, () =>
          proprietaire.query(
            `UPDATE "Incident" SET description = 'Autre récit' WHERE id = 'incident_a' AND "egliseId" = $1`,
            [a.egliseId],
          ),
        ),
      ),
    ).toBe("23514");
  });

  it("les notes s'ajoutent, non vides, sans modification ni suppression", async () => {
    const noter = (id: string, texte: string) =>
      dansA(
        `INSERT INTO "IncidentNote" (id, "egliseId", "incidentId", texte, auteur)
         VALUES ($1, $2, 'incident_a', $3, 'user_resp')`,
        [id, a.egliseId, texte],
      );
    expect(await noter("note_x", "   ")).toBe("23514");
    expect(await noter("note_1", "Les parents ont été prévenus à 10 h 40.")).toBeUndefined();
    expect(await noter("note_2", "Pansement refait à la sortie.")).toBeUndefined();
    expect(await dansA(`UPDATE "IncidentNote" SET texte = 'Effacé' WHERE id = 'note_1'`)).toBe(
      "42501",
    );
    expect(await dansA(`DELETE FROM "IncidentNote" WHERE id = 'note_1'`)).toBe("42501");
    // A closed incident still takes notes (the closure freezes nothing more than the content).
    await dansA(
      `UPDATE "Incident" SET "clotureLe" = now(), "cloturePar" = 'user_resp' WHERE id = 'incident_a'`,
    );
    expect(await noter("note_3", "Certificat médical reçu.")).toBeUndefined();
  });

  it("isolation A/B : les notes de A sont invisibles depuis B, et B ne peut pas en écrire dans A", async () => {
    await dansA(
      `INSERT INTO "IncidentNote" (id, "egliseId", "incidentId", texte, auteur)
       VALUES ('note_1', $1, 'incident_a', 'Note de A', 'user_resp')`,
      [a.egliseId],
    );
    // Isolation proof: unfiltered on purpose, church B must see no note at all.
    const { rows } = await enEglise(app, b.egliseId, () =>
      app.query(`SELECT id FROM "IncidentNote"`),
    );
    expect(rows).toEqual([]);
    expect(
      await codeErreur(
        enEglise(app, b.egliseId, () =>
          app.query(
            `INSERT INTO "IncidentNote" (id, "egliseId", "incidentId", texte, auteur)
             VALUES ('note_b', $1, 'incident_a', 'Écrite depuis B', 'user_b')`,
            [a.egliseId],
          ),
        ),
      ),
    ).toBe("42501");
    // In its own church, B cannot attach a note to A's incident (composite foreign key).
    expect(
      await codeErreur(
        enEglise(app, b.egliseId, () =>
          app.query(
            `INSERT INTO "IncidentNote" (id, "egliseId", "incidentId", texte, auteur)
             VALUES ('note_b', $1, 'incident_a', 'Écrite depuis B', 'user_b')`,
            [b.egliseId],
          ),
        ),
      ),
    ).toBe("23503");
  });
});

describe("écrans d'appel appairés (table de plateforme)", () => {
  const creer = (id: string) =>
    codeErreur(
      app.query(
        `INSERT INTO "EcranAppareil" (id, "egliseId", nom, "jetonHash", "jetonExpireLe", "creePar")
         VALUES ($1, $2, 'Salle principale', $3, now() + interval '24 hours', 'user_admin')`,
        [id, a.egliseId, `empreinte_${id}`],
      ),
    );
  const modifier = (sql: string) => codeErreur(app.query(sql));

  it("jamais effacé ; ni nom, ni église, ni lien modifiables", async () => {
    expect(await creer("ecran_1")).toBeUndefined();
    for (const sql of [
      `DELETE FROM "EcranAppareil" WHERE id = 'ecran_1'`,
      `UPDATE "EcranAppareil" SET nom = 'Autre' WHERE id = 'ecran_1'`,
      `UPDATE "EcranAppareil" SET "egliseId" = 'eglise_b' WHERE id = 'ecran_1'`,
      `UPDATE "EcranAppareil" SET "jetonExpireLe" = now() + interval '30 days' WHERE id = 'ecran_1'`,
    ]) {
      expect(await modifier(sql), sql).toBe("42501");
    }
  });

  it("l'appairage est complet et définitif ; la révocation aussi", async () => {
    await creer("ecran_1");
    expect(
      await modifier(`UPDATE "EcranAppareil" SET "appaireLe" = now() WHERE id = 'ecran_1'`),
    ).toBe("23514");
    expect(
      await modifier(
        `UPDATE "EcranAppareil" SET "appaireLe" = now(), "appareilHash" = 'appareil_1' WHERE id = 'ecran_1'`,
      ),
    ).toBeUndefined();
    expect(
      await modifier(
        `UPDATE "EcranAppareil" SET "appaireLe" = now(), "appareilHash" = 'appareil_2' WHERE id = 'ecran_1'`,
      ),
    ).toBe("23514");
    expect(
      await modifier(`UPDATE "EcranAppareil" SET "derniereVue" = now() WHERE id = 'ecran_1'`),
    ).toBeUndefined();
    expect(
      await modifier(`UPDATE "EcranAppareil" SET "revoqueLe" = now() WHERE id = 'ecran_1'`),
    ).toBe("23514");
    expect(
      await modifier(
        `UPDATE "EcranAppareil" SET "revoqueLe" = now(), "revoquePar" = 'user_admin' WHERE id = 'ecran_1'`,
      ),
    ).toBeUndefined();
    expect(
      await modifier(
        `UPDATE "EcranAppareil" SET "revoqueLe" = NULL, "revoquePar" = NULL WHERE id = 'ecran_1'`,
      ),
    ).toBe("23514");
  });
});

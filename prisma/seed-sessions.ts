/**
 * Lot 2 and 3 demonstration data (cahier §16), demonstration churches only, idempotent:
 * - a "Démonstration" service every day, so a session exists whatever the day of a demo;
 * - where the children are handed back (`checkout.lieu`), set once, never overwritten;
 * - last Sunday's session, closed: classes opened by their monitors, children checked in,
 *   arrived in class and collected, and one exceptional retrieval with its incident;
 * - in that session (lot 3), an infirmerie episode, a logged phone call and a parent call.
 * Call screens are never paired by the seed: the ADMIN pairs them on the device.
 *
 * The history cannot go through the lot 2 services: they stamp every row with the
 * database's now(), and the journal is append-only (RG-09), so it could not be moved back
 * afterwards. Its rows are written here with the same shapes as the services' (events,
 * audit entries, incident), their times computed by PostgreSQL from the session's start.
 */
import { randomUUID } from "node:crypto";
import { cleFichier } from "../src/lib/fichiers";
import type { Stockage } from "../src/lib/storage";
import { genererCodeRetrait } from "../src/server/checkin-regles";
import { silhouetteFictive } from "../src/server/plateforme/images-demo";
import type { DansEglise } from "./seed-familles";

/** Every day, in the church's own time (RG-12): a session exists on any day of a demo. */
export const CULTE_DEMO = { nom: "Démonstration", heureDebut: "07:00", heureFin: "22:00" };

/** Adds the daily demonstration service where it is missing. Returns the number created. */
export function semerCultesDemo(dansEglise: DansEglise, egliseId: string): Promise<number> {
  return dansEglise(
    (tx) => tx.$executeRaw`
      INSERT INTO "Culte" (id, "egliseId", nom, jour, "heureDebut", "heureFin")
      SELECT gen_random_uuid()::text, ${egliseId}, ${CULTE_DEMO.nom}, j.jour,
             ${CULTE_DEMO.heureDebut}, ${CULTE_DEMO.heureFin}
      FROM generate_series(0, 6) AS j(jour)
      WHERE NOT EXISTS (
        SELECT 1 FROM "Culte" c
        WHERE c."egliseId" = ${egliseId} AND c.nom = ${CULTE_DEMO.nom} AND c.jour = j.jour)`,
  );
}

/** Sets where children are handed back, unless the church already chose. */
export async function semerLieuRetrait(
  dansEglise: DansEglise,
  egliseId: string,
  lieu: "ACCUEIL" | "ACCUEIL_ET_CLASSES",
): Promise<void> {
  await dansEglise(
    (tx) => tx.$executeRaw`
      INSERT INTO "Parametre" ("egliseId", cle, valeur)
      VALUES (${egliseId}, 'checkout.lieu', ${JSON.stringify(lieu)}::jsonb)
      ON CONFLICT ("egliseId", cle) DO NOTHING`,
  );
}

export type ActeursHistorique = {
  accueil: string;
  responsable: string;
  /** Six monitors (account ids, member ids): two per opened class. */
  moniteurs: { userId: string; membreId: string }[];
};

/** Families of last Sunday's session; the last one is collected by an unrecognised adult. */
export const FAMILLES_HISTORIQUE = 8;
/** Classes opened last Sunday, by order: two monitors each. */
const CLASSES_HISTORIQUE = 3;

export const idSessionHistorique = (egliseId: string) => `${egliseId}_demo_dimanche`;

/** Time allowed to the history's transaction, instead of Prisma's 5 s. */
export const HISTORIQUE_TIMEOUT_MS = 60_000;

/**
 * Last Sunday's "Culte 1" session, closed. Returns false when it exists already, or when
 * the church has no such service or already held a session that day.
 */
export async function semerHistorique(
  dansEglise: DansEglise,
  egliseId: string,
  acteurs: ActeursHistorique,
  stockage: Stockage,
): Promise<boolean> {
  const sessionId = idSessionHistorique(egliseId);
  const deja = await dansEglise((tx) =>
    tx.session.findUnique({ where: { id: sessionId }, select: { id: true } }),
  );
  if (deja || acteurs.moniteurs.length < 2 * CLASSES_HISTORIQUE) return false;

  // The photo is stored before the transaction (storage is not transactional), removed if
  // nothing was written.
  const photoKey = cleFichier(egliseId, "retraits", `${randomUUID()}.png`);
  await stockage.put(photoKey, await silhouetteFictive(97), "image/png");
  let ecrit = false;
  try {
    // Over a hundred statements, one round trip each: 5.2 s on Neon from a GitHub runner
    // (2026-11-24), past Prisma's default 5 s.
    ecrit = await dansEglise((tx) => ecrireHistorique(tx, egliseId, sessionId, acteurs, photoKey), {
      timeout: HISTORIQUE_TIMEOUT_MS,
    });
  } finally {
    if (!ecrit) await stockage.delete(photoKey);
  }
  return ecrit;
}

type Tx = Parameters<Parameters<DansEglise>[0]>[0];
type Json = Record<string, unknown>;

async function ecrireHistorique(
  tx: Tx,
  egliseId: string,
  sessionId: string,
  acteurs: ActeursHistorique,
  photoKey: string,
): Promise<boolean> {
  // Last Sunday before today, in the church's time zone; hours of its "Culte 1", in UTC.
  const creees = await tx.$executeRaw`
    INSERT INTO "Session" (id, "egliseId", "culteId", date, debut, fin, statut)
    SELECT ${sessionId}, c."egliseId", c.id, d.dimanche,
           ((d.dimanche + c."heureDebut"::time) AT TIME ZONE e.fuseau) AT TIME ZONE 'UTC',
           ((d.dimanche + c."heureFin"::time) AT TIME ZONE e.fuseau) AT TIME ZONE 'UTC',
           'CLOTUREE'
    FROM "Culte" c
    JOIN "Eglise" e ON e.id = c."egliseId"
    CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE e.fuseau)::date AS jour) j
    CROSS JOIN LATERAL (
      SELECT j.jour - (CASE WHEN extract(dow FROM j.jour) = 0 THEN 7
                            ELSE extract(dow FROM j.jour)::int END) AS dimanche) d
    WHERE c."egliseId" = ${egliseId} AND c.nom = 'Culte 1' AND c.jour = 0
    ORDER BY c.id
    LIMIT 1
    ON CONFLICT DO NOTHING`;
  if (creees === 0) return false;

  // Every time below is written in SQL as the session's start plus a number of minutes
  // (negative before it): `(SELECT debut FROM "Session" WHERE id = …) + make_interval(…)`.
  /** Minutes from the session's start to its end. */
  const [session] = await tx.$queryRaw<{ duree: number }[]>`
    SELECT (extract(epoch FROM fin - debut) / 60)::int AS duree
    FROM "Session" WHERE id = ${sessionId}`;
  const duree = session!.duree;

  const evenement = (presenceId: string, type: string, detail: Json, userId: string, m: number) =>
    tx.$executeRaw`
      INSERT INTO "EvenementPresence" (id, "egliseId", "presenceId", type, detail, "userId", "createdAt")
      VALUES (${randomUUID()}, ${egliseId}, ${presenceId}, ${type},
              ${JSON.stringify(detail)}::jsonb, ${userId},
              (SELECT debut FROM "Session" WHERE id = ${sessionId}) + make_interval(mins => ${m}::int))`;
  const audit = (
    userId: string,
    entree: { action: string; entite: string; entiteId: string; avant?: Json; apres?: Json },
    m: number,
  ) => tx.$executeRaw`
      INSERT INTO "AuditLog" (id, "egliseId", "userId", action, entite, "entiteId", avant, apres, "createdAt")
      VALUES (${randomUUID()}, ${egliseId}, ${userId}, ${entree.action}, ${entree.entite},
              ${entree.entiteId},
              ${entree.avant ? JSON.stringify(entree.avant) : null}::jsonb,
              ${entree.apres ? JSON.stringify(entree.apres) : null}::jsonb,
              (SELECT debut FROM "Session" WHERE id = ${sessionId}) + make_interval(mins => ${m}::int))`;

  await audit(
    acteurs.responsable,
    {
      action: "session.ouverte",
      entite: "Session",
      entiteId: sessionId,
      avant: { statut: "PLANIFIEE" },
      apres: { statut: "OUVERTE" },
    },
    -40,
  );

  // The first classes by order, each opened by its second monitor (RG-05).
  const classes = await tx.$queryRaw<{ id: string; minMoniteurs: number }[]>`
    SELECT id, "minMoniteurs" FROM "Classe"
    WHERE "egliseId" = ${egliseId} AND active
    ORDER BY ordre, id
    LIMIT ${CLASSES_HISTORIQUE}`;
  const ouvertes = new Map<string, { sessionClasseId: string; moniteur: string }>();
  for (const [i, classe] of classes.entries()) {
    const sessionClasseId = randomUUID();
    const ouverture = -30 + 3 * i + 1;
    await tx.$executeRaw`
      INSERT INTO "SessionClasse" (id, "egliseId", "sessionId", "classeId", "ouverteLe")
      VALUES (${sessionClasseId}, ${egliseId}, ${sessionId}, ${classe.id},
              (SELECT debut FROM "Session" WHERE id = ${sessionId}) + make_interval(mins => ${ouverture}::int))`;
    const binome = acteurs.moniteurs.slice(2 * i, 2 * i + 2);
    for (const [k, moniteur] of binome.entries()) {
      const affectationId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "AffectationMoniteur" (id, "egliseId", "sessionClasseId", "membreId", arrivee, depart)
        SELECT ${affectationId}, ${egliseId}, ${sessionClasseId}, ${moniteur.membreId},
               s.debut + make_interval(mins => ${-30 + 3 * i + k}::int),
               s.debut + make_interval(mins => ${duree + 40}::int)
        FROM "Session" s WHERE s.id = ${sessionId}`;
      await audit(
        moniteur.userId,
        {
          action: "moniteur.arrive",
          entite: "AffectationMoniteur",
          entiteId: affectationId,
          apres: { sessionClasseId, membreId: moniteur.membreId, renfort: false },
        },
        -30 + 3 * i + k,
      );
    }
    await audit(
      binome[1]!.userId,
      {
        action: "classe.ouverte",
        entite: "SessionClasse",
        entiteId: sessionClasseId,
        apres: { moniteurs: 2, minimum: classe.minMoniteurs },
      },
      ouverture,
    );
    ouvertes.set(classe.id, { sessionClasseId, moniteur: binome[0]!.userId });
  }

  // Children of finalised families, in the class of their age on that Sunday (RG-17) or
  // their forced class; only the opened classes.
  const enfants = await tx.$queryRaw<
    { enfantId: string; familleId: string; prenom: string; classeId: string | null }[]
  >`
    SELECT e.id AS "enfantId", e."familleId", e.prenom,
           COALESCE(e."classeForceeId", (
             SELECT c.id FROM "Classe" c
             WHERE c."egliseId" = e."egliseId" AND c.active
               AND (extract(year FROM age(s.date, e."dateNaissance"::date)) * 12
                    + extract(month FROM age(s.date, e."dateNaissance"::date)))
                   BETWEEN c."ageMinMois" AND c."ageMaxMois"
             ORDER BY c.ordre LIMIT 1)) AS "classeId"
    FROM "Enfant" e
    JOIN "Famille" f ON f.id = e."familleId"
    JOIN "Session" s ON s.id = ${sessionId}
    WHERE e."egliseId" = ${egliseId} AND f."finaliseeLe" IS NOT NULL AND e.matricule IS NOT NULL
    ORDER BY f.nom, f.id, e."dateNaissance", e.id`;
  const familles = new Map<string, { enfantId: string; prenom: string; classeId: string }[]>();
  for (const e of enfants) {
    if (!e.classeId || !ouvertes.has(e.classeId)) continue;
    if (!familles.has(e.familleId) && familles.size === FAMILLES_HISTORIQUE) continue;
    familles.set(e.familleId, [
      ...(familles.get(e.familleId) ?? []),
      { enfantId: e.enfantId, prenom: e.prenom, classeId: e.classeId },
    ]);
  }

  const codes = new Set<string>();
  const liste = [...familles.entries()];
  for (const [f, [familleId, membres]] of liste.entries()) {
    let code = genererCodeRetrait();
    while (codes.has(code)) code = genererCodeRetrait();
    codes.add(code);
    const exceptionnel = f === liste.length - 1;
    const arrivee = -20 + 2 * f;
    const retrait = duree + 5 + 2 * f;

    // The authorised adult who collects them: the main guardian first.
    const [personne] = await tx.$queryRaw<{ id: string }[]>`
      SELECT pa.id FROM "PersonneAutorisee" pa
      LEFT JOIN "Tuteur" t ON t.id = pa."tuteurId"
      WHERE pa."familleId" = ${familleId} AND pa.actif
      ORDER BY t.principal DESC NULLS LAST, pa.id
      LIMIT 1`;
    let retraitExceptionnelId: string | null = null;
    if (exceptionnel) {
      const incidentId = randomUUID();
      retraitExceptionnelId = randomUUID();
      const motif =
        "Les parents sont retenus au travail ; l'oncle vient chercher les enfants. Contact principal joint par téléphone.";
      await tx.$executeRaw`
        INSERT INTO "Incident" (id, "egliseId", "sessionId", type, description, personnes, mesures,
                                "declarePar", "createdAt")
        VALUES (${incidentId}, ${egliseId}, ${sessionId}, 'RETRAIT_NON_AUTORISE',
                ${`Retrait exceptionnel : ${membres.map((m) => m.prenom).join(", ")} remis à un adulte qui n'est pas parmi les personnes autorisées. Motif : ${motif}`},
                'Rodrigue Dossa (Oncle)',
                'Contact principal appelé ; retrait autorisé par le responsable avec son PIN.',
                ${acteurs.accueil},
                (SELECT debut FROM "Session" WHERE id = ${sessionId}) + make_interval(mins => ${retrait}::int))`;
      await tx.$executeRaw`
        INSERT INTO "RetraitExceptionnel" (id, "egliseId", "sessionId", "familleId", nom, lien,
                                           telephone, "photoKey", motif, "autorisePar", "remisPar",
                                           "incidentId", "createdAt")
        VALUES (${retraitExceptionnelId}, ${egliseId}, ${sessionId}, ${familleId},
                'Rodrigue Dossa', 'Oncle', '+2290196099000', ${photoKey}, ${motif},
                ${acteurs.responsable}, ${acteurs.accueil}, ${incidentId},
                (SELECT debut FROM "Session" WHERE id = ${sessionId}) + make_interval(mins => ${retrait}::int))`;
      await audit(
        acteurs.accueil,
        {
          action: "incident.cree",
          entite: "Incident",
          entiteId: incidentId,
          apres: { type: "RETRAIT_NON_AUTORISE", sessionId },
        },
        retrait,
      );
      await audit(
        acteurs.accueil,
        {
          action: "retrait.exceptionnel",
          entite: "RetraitExceptionnel",
          entiteId: retraitExceptionnelId,
          apres: { familleId, autorisePar: acteurs.responsable, incidentId },
        },
        retrait,
      );
    }

    for (const enfant of membres) {
      const presenceId = randomUUID();
      const classe = ouvertes.get(enfant.classeId)!;
      await tx.$executeRaw`
        INSERT INTO "Presence" (id, "egliseId", "sessionId", "enfantId", "classeId", statut,
                               "codeRetrait", "checkinPar", "checkinLe", "enSalleLe",
                               "recupereLe", "recuperePar", "remisPar", "retraitExceptionnelId")
        SELECT ${presenceId}, ${egliseId}, ${sessionId}, ${enfant.enfantId}, ${enfant.classeId},
               'RECUPERE', ${code}, ${acteurs.accueil},
               s.debut + make_interval(mins => ${arrivee}::int),
               s.debut + make_interval(mins => ${arrivee + 5}::int),
               s.debut + make_interval(mins => ${retrait}::int),
               ${exceptionnel ? null : personne!.id}, ${acteurs.accueil}, ${retraitExceptionnelId}
        FROM "Session" s WHERE s.id = ${sessionId}`;
      await evenement(
        presenceId,
        "checkin",
        { statut: "PRESENT", classeId: enfant.classeId, carte: "scan" },
        acteurs.accueil,
        arrivee,
      );
      await audit(
        acteurs.accueil,
        {
          action: "presence.checkin",
          entite: "Presence",
          entiteId: presenceId,
          apres: { enfantId: enfant.enfantId, classeId: enfant.classeId, statut: "PRESENT" },
        },
        arrivee,
      );
      await evenement(
        presenceId,
        "en_salle",
        { statut: "EN_SALLE", classeId: enfant.classeId, mode: "toucher" },
        classe.moniteur,
        arrivee + 5,
      );
      await audit(
        classe.moniteur,
        {
          action: "presence.en_salle",
          entite: "Presence",
          entiteId: presenceId,
          avant: { statut: "PRESENT" },
          apres: { statut: "EN_SALLE" },
        },
        arrivee + 5,
      );
      const apres = exceptionnel
        ? { statut: "RECUPERE", retraitExceptionnelId }
        : { statut: "RECUPERE", personneAutoriseeId: personne!.id };
      await evenement(
        presenceId,
        "checkout",
        exceptionnel
          ? { statut: "RECUPERE", depuis: "EN_SALLE", retraitExceptionnelId }
          : {
              statut: "RECUPERE",
              depuis: "EN_SALLE",
              personneAutoriseeId: personne!.id,
              carte: f % 3 === 1 ? "code" : "scan",
            },
        acteurs.accueil,
        retrait,
      );
      await audit(
        acteurs.accueil,
        {
          action: "presence.checkout",
          entite: "Presence",
          entiteId: presenceId,
          avant: { statut: "EN_SALLE" },
          apres,
        },
        retrait,
      );
    }
  }

  await audit(
    acteurs.responsable,
    {
      action: "session.cloturee",
      entite: "Session",
      entiteId: sessionId,
      avant: { statut: "OUVERTE" },
      apres: { statut: "CLOTUREE", moniteursSortis: 2 * classes.length },
    },
    duree + 40,
  );
  return true;
}

/**
 * Lot 3, added to last Sunday's session (also on a base where the lot 2 history already
 * exists): the first child checked in went to the infirmerie with his monitor, was received
 * there, his main contact was phoned (logged, reached) and called to the screen; the parent
 * came, the child went back to class (PRESENT, confirmed again by his monitor), then was
 * collected as before. Same shapes as the lot 3 services, times from the session's start.
 * Returns false when the session is missing or the episode is already there.
 */
export async function semerEpisodeInfirmerie(
  dansEglise: DansEglise,
  egliseId: string,
  acteurs: { accueil: string; infirmerie: string },
): Promise<boolean> {
  const sessionId = idSessionHistorique(egliseId);
  // About twenty round trips: well under 5 s, but Neon from a GitHub runner is slow.
  const delai = { timeout: HISTORIQUE_TIMEOUT_MS };
  return dansEglise(async (tx) => {
    const [cible] = await tx.$queryRaw<
      { presenceId: string; classeId: string; familleId: string; moniteur: string | null }[]
    >`
      SELECT p.id AS "presenceId", p."classeId", e."familleId",
             (SELECT m."userId" FROM "AffectationMoniteur" a
                JOIN "SessionClasse" sc ON sc.id = a."sessionClasseId"
                JOIN "Membre" m ON m.id = a."membreId"
               WHERE sc."sessionId" = p."sessionId" AND sc."classeId" = p."classeId"
               ORDER BY a.arrivee, a.id LIMIT 1) AS moniteur
      FROM "Presence" p JOIN "Enfant" e ON e.id = p."enfantId"
      WHERE p."sessionId" = ${sessionId} AND p."retraitExceptionnelId" IS NULL
      ORDER BY p."checkinLe", p.id
      LIMIT 1`;
    if (!cible?.moniteur) return false;
    const [deja] = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "Appel" WHERE "presenceId" = ${cible.presenceId}`;
    if (deja!.n > 0) return false;

    const { presenceId, classeId, moniteur } = cible;
    // Every time below: the session's start plus a number of minutes, computed by PostgreSQL.
    const evenement = (type: string, detail: Json, userId: string, m: number) =>
      tx.$executeRaw`
        INSERT INTO "EvenementPresence" (id, "egliseId", "presenceId", type, detail, "userId", "createdAt")
        SELECT ${randomUUID()}, ${egliseId}, ${presenceId}, ${type},
               ${JSON.stringify(detail)}::jsonb, ${userId}, s.debut + make_interval(mins => ${m}::int)
        FROM "Session" s WHERE s.id = ${sessionId}`;
    const audit = (
      userId: string,
      action: string,
      entite: string,
      entiteId: string,
      apres: Json,
      m: number,
    ) =>
      tx.$executeRaw`
        INSERT INTO "AuditLog" (id, "egliseId", "userId", action, entite, "entiteId", apres, "createdAt")
        SELECT ${randomUUID()}, ${egliseId}, ${userId}, ${action}, ${entite}, ${entiteId},
               ${JSON.stringify(apres)}::jsonb, s.debut + make_interval(mins => ${m}::int)
        FROM "Session" s WHERE s.id = ${sessionId}`;

    // 20 minutes into the service: fever, to the infirmerie with the class's monitor.
    await evenement(
      "infirmerie",
      { statut: "INFIRMERIE", depuis: "EN_SALLE", accompagnant: moniteur, motif: "Fièvre" },
      moniteur,
      20,
    );
    await audit(
      moniteur,
      "presence.infirmerie",
      "Presence",
      presenceId,
      { statut: "INFIRMERIE", accompagnant: moniteur },
      20,
    );
    await evenement("infirmerie_recue", { statut: "INFIRMERIE" }, acteurs.infirmerie, 22);
    await audit(
      acteurs.infirmerie,
      "presence.infirmerie_recue",
      "Presence",
      presenceId,
      { statut: "INFIRMERIE", recu: true },
      22,
    );

    // The main contact phoned from the Urgence button, reached.
    const [tuteur] = await tx.$queryRaw<{ telephone: string | null }[]>`
      SELECT telephone FROM "Tuteur"
      WHERE "familleId" = ${cible.familleId} AND principal ORDER BY id LIMIT 1`;
    if (tuteur?.telephone) {
      const appelTelId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "AppelTelephonique" (id, "egliseId", "presenceId", "enfantId", numero, canal,
                                         resultat, "resultatLe", "userId", "createdAt")
        SELECT ${appelTelId}, ${egliseId}, p.id, p."enfantId", ${tuteur.telephone}, 'tel',
               'joint', s.debut + interval '25 minutes', ${acteurs.infirmerie},
               s.debut + interval '24 minutes'
        FROM "Presence" p JOIN "Session" s ON s.id = p."sessionId" WHERE p.id = ${presenceId}`;
      await audit(
        acteurs.infirmerie,
        "appel.telephone",
        "AppelTelephonique",
        appelTelId,
        { presenceId, canal: "tel" },
        24,
      );
      await audit(
        acteurs.infirmerie,
        "appel.resultat",
        "AppelTelephonique",
        appelTelId,
        { resultat: "joint" },
        25,
      );
    }

    // The parent called to the screen, to the infirmerie; arrived.
    const appelId = randomUUID();
    await tx.$executeRaw`
      INSERT INTO "Appel" (id, "egliseId", "presenceId", motif, lieu, "creePar", "creeLe",
                           "resoluLe", resolution, "resoluPar")
      SELECT ${appelId}, ${egliseId}, ${presenceId}, 'soins', 'Infirmerie', ${acteurs.infirmerie},
             s.debut + interval '25 minutes', s.debut + interval '32 minutes', 'parent_arrive',
             ${acteurs.accueil}
      FROM "Session" s WHERE s.id = ${sessionId}`;
    await evenement(
      "appel_parent",
      { appelId, motif: "soins", lieu: "Infirmerie" },
      acteurs.infirmerie,
      25,
    );
    await audit(
      acteurs.infirmerie,
      "appel.cree",
      "Appel",
      appelId,
      { presenceId, motif: "soins", lieu: "Infirmerie" },
      25,
    );
    await evenement(
      "appel_parent_resolu",
      { appelId, resolution: "parent_arrive" },
      acteurs.accueil,
      32,
    );
    await audit(
      acteurs.accueil,
      "appel.resolu",
      "Appel",
      appelId,
      { presenceId, resolution: "parent_arrive" },
      32,
    );

    // Back to class, PRESENT, confirmed again by the monitor (decision of 2026-11-24).
    await evenement("infirmerie_retour", { statut: "PRESENT", recu: true }, acteurs.infirmerie, 35);
    await audit(
      acteurs.infirmerie,
      "presence.infirmerie_retour",
      "Presence",
      presenceId,
      { statut: "PRESENT" },
      35,
    );
    await evenement("en_salle", { statut: "EN_SALLE", classeId, mode: "toucher" }, moniteur, 37);
    await audit(moniteur, "presence.en_salle", "Presence", presenceId, { statut: "EN_SALLE" }, 37);
    await tx.$executeRaw`
      UPDATE "Presence" p
      SET "retourInfirmerieLe" = s.debut + interval '35 minutes',
          "enSalleLe" = s.debut + interval '37 minutes'
      FROM "Session" s
      WHERE p.id = ${presenceId} AND s.id = p."sessionId"`;
    return true;
  }, delai);
}

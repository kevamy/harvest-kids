import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { TypeIncident } from "@/generated/prisma/enums";
import { journaliser } from "@/lib/audit";
import { TYPES_DECLARABLES } from "@/lib/incidents";
import type { ClientDeBase, ContexteEglise } from "@/lib/tenant";

/**
 * Incidents of the church (cahier §7.5, §7.6), for the RESPONSABLE and the ADMIN. The list
 * never carries a photo; the detail of an exceptional retrieval shows the photo of the adult
 * (key only: the file route checks the right again). Dates are formatted by the database in
 * the church's time zone (RG-12).
 */

export { LIBELLES_INCIDENT } from "@/lib/incidents";

export type LigneIncident = {
  id: string;
  type: TypeIncident;
  /** "15/11/2026 10:42", in the church's time zone. */
  date: string;
  description: string;
  clos: boolean;
};

export async function listerIncidents(
  db: Pick<ClientDeBase, "$queryRaw">,
): Promise<LigneIncident[]> {
  return db.$queryRaw<LigneIncident[]>`
    SELECT i.id, i.type::text AS type, i.description, i."clotureLe" IS NOT NULL AS clos,
           to_char(i."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE e.fuseau, 'DD/MM/YYYY HH24:MI')
             AS date
    FROM "Incident" i JOIN "Eglise" e ON e.id = i."egliseId"
    ORDER BY i."createdAt" DESC, i.id DESC
    LIMIT 100`;
}

export type DetailIncident = LigneIncident & {
  personnes: string | null;
  mesures: string | null;
  declarePar: string;
  /** The child concerned, if any. */
  enfant: { prenom: string; nom: string; matricule: string | null } | null;
  /** "16/11/2026 09:12" and who closed it, once closed. */
  clotureLe: string | null;
  cloturePar: string | null;
  /** Notes added after the declaration, oldest first (append only). */
  notes: { id: string; texte: string; auteur: string; date: string }[];
  retrait: {
    nom: string;
    lien: string | null;
    telephone: string | null;
    motif: string;
    photoKey: string;
    autorisePar: string;
    remisPar: string;
    enfants: { prenom: string; matricule: string | null }[];
  } | null;
};

/** One incident, with its exceptional retrieval if any; null when missing (or elsewhere). */
export async function detailIncident(
  db: Pick<ClientDeBase, "$queryRaw">,
  id: string,
): Promise<DetailIncident | null> {
  const [incident] = await db.$queryRaw<Omit<DetailIncident, "retrait">[]>`
    SELECT i.id, i.type::text AS type, i.description, i.personnes, i.mesures, i."declarePar",
           i."clotureLe" IS NOT NULL AS clos, i."cloturePar",
           to_char(i."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE e.fuseau, 'DD/MM/YYYY HH24:MI')
             AS date,
           to_char(i."clotureLe" AT TIME ZONE 'UTC' AT TIME ZONE e.fuseau, 'DD/MM/YYYY HH24:MI')
             AS "clotureLe",
           CASE WHEN x.id IS NULL THEN NULL
                ELSE json_build_object('prenom', x.prenom, 'nom', x.nom, 'matricule', x.matricule)
           END AS enfant,
           COALESCE(
             (SELECT json_agg(json_build_object(
                       'id', n.id, 'texte', n.texte, 'auteur', n.auteur,
                       'date', to_char(n."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE e.fuseau,
                                       'DD/MM/YYYY HH24:MI'))
                     ORDER BY n."createdAt", n.id)
              FROM "IncidentNote" n WHERE n."incidentId" = i.id),
             '[]'::json) AS notes
    FROM "Incident" i JOIN "Eglise" e ON e.id = i."egliseId"
    LEFT JOIN "Enfant" x ON x.id = i."enfantId"
    WHERE i.id = ${id}`;
  if (!incident) return null;

  const [retrait] = await db.$queryRaw<NonNullable<DetailIncident["retrait"]>[]>`
    SELECT r.nom, r.lien, r.telephone, r.motif, r."photoKey", r."autorisePar", r."remisPar",
           COALESCE(
             (SELECT json_agg(json_build_object('prenom', x.prenom, 'matricule', x.matricule)
                              ORDER BY x."dateNaissance", x.prenom)
              FROM "Presence" p JOIN "Enfant" x ON x.id = p."enfantId"
              WHERE p."retraitExceptionnelId" = r.id),
             '[]'::json) AS enfants
    FROM "RetraitExceptionnel" r
    WHERE r."incidentId" = ${id}`;
  return { ...incident, retrait: retrait ?? null };
}

type Auteur = Pick<ContexteEglise, "userId" | "appareil">;
type Tx = Pick<ClientDeBase, "$queryRaw" | "evenementPresence" | "auditLog">;

export class IncidentRefuse extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncidentRefuse";
  }
}

const texteFacultatif = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((t) => t || null);

export const schemaDeclaration = z.object({
  presenceId: z.string().min(1),
  type: z.enum(TYPES_DECLARABLES, { message: "Choisissez le type d'incident." }),
  description: z
    .string({ message: "Décrivez ce qui s'est passé." })
    .trim()
    .min(5, "Décrivez ce qui s'est passé en quelques mots.")
    .max(2000, "La description tient en 2 000 caractères au plus."),
  personnes: texteFacultatif(500, "Les personnes présentes tiennent en 500 caractères au plus."),
  mesures: texteFacultatif(1000, "Les mesures prises tiennent en 1 000 caractères au plus."),
});

/**
 * An incident declared from a child's card (cahier §7.9), attached to the child and to the
 * session of the presence. Once declared, its content no longer changes (database rights);
 * what comes later goes in notes. Event on the presence and audit, in one transaction.
 */
export async function declarerIncident(
  tx: Tx,
  auteur: Auteur,
  saisie: unknown,
): Promise<{ incidentId: string }> {
  const { presenceId, type, description, personnes, mesures } = schemaDeclaration.parse(saisie);
  const [cree] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "Incident" (id, "egliseId", "sessionId", "enfantId", type, description, personnes,
                            mesures, "declarePar")
    SELECT gen_random_uuid()::text, p."egliseId", p."sessionId", p."enfantId",
           ${type}::"TypeIncident", ${description}, ${personnes}, ${mesures}, ${auteur.userId}
    FROM "Presence" p WHERE p.id = ${presenceId}
    RETURNING id`;
  if (!cree) throw new IncidentRefuse("Enfant introuvable. Rechargez la page.");
  const evenement: Omit<Prisma.EvenementPresenceUncheckedCreateInput, "egliseId"> = {
    presenceId,
    type: "incident",
    detail: { incidentId: cree.id, type },
    userId: auteur.userId,
    appareil: auteur.appareil,
  };
  // egliseId is added by the scoped client.
  await tx.evenementPresence.create({
    data: evenement as Prisma.EvenementPresenceUncheckedCreateInput,
  });
  await journaliser(tx, auteur, {
    action: "incident.cree",
    entite: "Incident",
    entiteId: cree.id,
    apres: { type, presenceId },
  });
  return { incidentId: cree.id };
}

export const schemaNote = z.object({
  incidentId: z.string().min(1),
  texte: z
    .string({ message: "Écrivez la note." })
    .trim()
    .min(3, "Écrivez la note en quelques mots.")
    .max(1000, "La note tient en 1 000 caractères au plus."),
});

/** A note added to an incident, open or closed (append only). */
export async function ajouterNoteIncident(
  tx: Pick<ClientDeBase, "$queryRaw" | "auditLog">,
  auteur: Auteur,
  saisie: unknown,
): Promise<void> {
  const { incidentId, texte } = schemaNote.parse(saisie);
  const [note] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "IncidentNote" (id, "egliseId", "incidentId", texte, auteur)
    SELECT gen_random_uuid()::text, i."egliseId", i.id, ${texte}, ${auteur.userId}
    FROM "Incident" i WHERE i.id = ${incidentId}
    RETURNING id`;
  if (!note) throw new IncidentRefuse("Incident introuvable. Rechargez la page.");
  await journaliser(tx, auteur, {
    action: "incident.note",
    entite: "Incident",
    entiteId: incidentId,
    apres: { noteId: note.id },
  });
}

/** Closes an incident, once (the database refuses a second closure). */
export async function cloturerIncident(
  tx: Pick<ClientDeBase, "$queryRaw" | "auditLog">,
  auteur: Auteur,
  incidentId: string,
): Promise<void> {
  const [clos] = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Incident" SET "clotureLe" = now(), "cloturePar" = ${auteur.userId}
    WHERE id = ${incidentId} AND "clotureLe" IS NULL
    RETURNING id`;
  if (!clos) throw new IncidentRefuse("Cet incident est déjà clos, ou introuvable. Rechargez.");
  await journaliser(tx, auteur, {
    action: "incident.clos",
    entite: "Incident",
    entiteId: incidentId,
    apres: { clos: true },
  });
}

export type IncidentDeSession = {
  id: string;
  type: TypeIncident;
  /** "10:42", in the church's time zone. */
  heure: string;
  prenom: string | null;
  clos: boolean;
};

/** Incidents of the open sessions, for the RESPONSABLE's dashboard, latest first. */
export async function incidentsDesSessionsOuvertes(
  db: Pick<ClientDeBase, "$queryRaw">,
): Promise<IncidentDeSession[]> {
  return db.$queryRaw<IncidentDeSession[]>`
    SELECT i.id, i.type::text AS type, x.prenom, i."clotureLe" IS NOT NULL AS clos,
           to_char(i."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE g.fuseau, 'HH24:MI') AS heure
    FROM "Incident" i
    JOIN "Session" s ON s.id = i."sessionId"
    JOIN "Eglise" g ON g.id = i."egliseId"
    LEFT JOIN "Enfant" x ON x.id = i."enfantId"
    WHERE s.statut = 'OUVERTE'
    ORDER BY i."createdAt" DESC, i.id`;
}

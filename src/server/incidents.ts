import "server-only";
import type { TypeIncident } from "@/generated/prisma/enums";
import type { ClientDeBase } from "@/lib/tenant";

/**
 * Incidents of the church (cahier §7.5, §7.6), for the RESPONSABLE and the ADMIN. The list
 * never carries a photo; the detail of an exceptional retrieval shows the photo of the adult
 * (key only: the file route checks the right again). Dates are formatted by the database in
 * the church's time zone (RG-12).
 */

export const LIBELLES_INCIDENT: Record<TypeIncident, string> = {
  BLESSURE: "Blessure",
  MALAISE: "Malaise",
  COMPORTEMENT: "Comportement",
  ENFANT_INTROUVABLE: "Enfant introuvable",
  RETRAIT_NON_AUTORISE: "Retrait par une personne non autorisée",
  AUTRE: "Autre",
};

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
           i."clotureLe" IS NOT NULL AS clos,
           to_char(i."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE e.fuseau, 'DD/MM/YYYY HH24:MI')
             AS date
    FROM "Incident" i JOIN "Eglise" e ON e.id = i."egliseId"
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

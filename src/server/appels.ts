import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { MOTIFS_APPEL, type MotifAppel } from "@/lib/appels";
import { journaliser } from "@/lib/audit";
import type { ClientDeBase, ContexteEglise } from "@/lib/tenant";

/**
 * Parent call (cahier §7.5, ADR 0019): from the child's card, a reason and a meeting place
 * (one of the church's appels.lieux). The call shows on the call screen (matricule and place,
 * never a name: RG-10) until the parent arrives, it is cancelled, or the child is collected
 * (resolved in the check-out's transaction). One open call per presence (partial unique
 * index); its resolution is set once (database trigger).
 */

type Auteur = Pick<ContexteEglise, "userId" | "appareil">;
type Tx = Pick<ClientDeBase, "$queryRaw" | "evenementPresence" | "auditLog">;

export class AppelRefuse extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppelRefuse";
  }
}

const MOTIFS = Object.keys(MOTIFS_APPEL) as [MotifAppel, ...MotifAppel[]];

export const schemaAppel = z.object({
  presenceId: z.string().min(1),
  motif: z.enum(MOTIFS, { message: "Choisissez le motif de l'appel." }),
  lieu: z.string().trim().min(1, "Choisissez le lieu de rendez-vous."),
});

async function tracer(
  tx: Tx,
  auteur: Auteur,
  presenceId: string,
  appelId: string,
  type: "appel_parent" | "appel_parent_resolu",
  detail: Prisma.InputJsonObject,
) {
  const evenement: Omit<Prisma.EvenementPresenceUncheckedCreateInput, "egliseId"> = {
    presenceId,
    type,
    detail: { appelId, ...detail },
    userId: auteur.userId,
    appareil: auteur.appareil,
  };
  // egliseId is added by the scoped client.
  await tx.evenementPresence.create({
    data: evenement as Prisma.EvenementPresenceUncheckedCreateInput,
  });
  await journaliser(tx, auteur, {
    action: type === "appel_parent" ? "appel.cree" : "appel.resolu",
    entite: "Appel",
    entiteId: appelId,
    apres: { presenceId, ...detail },
  });
}

/** Calls the parent of a child still in an open session, to a place of the church's list. */
export async function appelerParent(
  tx: Tx,
  auteur: Auteur,
  saisie: unknown,
  lieuxAutorises: readonly string[],
): Promise<{ prenom: string }> {
  const { presenceId, motif, lieu } = schemaAppel.parse(saisie);
  if (!lieuxAutorises.includes(lieu)) {
    throw new AppelRefuse("Ce lieu n'est plus proposé : rechargez la fiche.");
  }
  // The presence row is locked: two calls made at the same time create one.
  const [presence] = await tx.$queryRaw<{ prenom: string; statut: string; ouverte: boolean }[]>`
    SELECT e.prenom, p.statut::text AS statut, s.statut = 'OUVERTE' AS ouverte
    FROM "Presence" p JOIN "Enfant" e ON e.id = p."enfantId"
    JOIN "Session" s ON s.id = p."sessionId"
    WHERE p.id = ${presenceId} AND p."basculeVers" IS NULL
    FOR UPDATE OF p`;
  if (!presence) throw new AppelRefuse("Enfant introuvable dans cette session. Rechargez.");
  if (!presence.ouverte || presence.statut === "RECUPERE") {
    throw new AppelRefuse(`${presence.prenom} n'est plus dans une session ouverte.`);
  }
  const [cree] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "Appel" (id, "egliseId", "presenceId", motif, lieu, "creePar")
    SELECT gen_random_uuid()::text, p."egliseId", p.id, ${motif}, ${lieu}, ${auteur.userId}
    FROM "Presence" p
    WHERE p.id = ${presenceId}
      AND NOT EXISTS (SELECT 1 FROM "Appel" a WHERE a."presenceId" = p.id AND a."resoluLe" IS NULL)
    RETURNING id`;
  if (!cree) {
    throw new AppelRefuse(`Le parent de ${presence.prenom} est déjà appelé.`);
  }
  await tracer(tx, auteur, presenceId, cree.id, "appel_parent", { motif, lieu });
  return { prenom: presence.prenom };
}

export const schemaResolution = z.object({
  presenceId: z.string().min(1),
  resolution: z.enum(["parent_arrive", "annule"], {
    message: "Choisissez comment l'appel se termine.",
  }),
});

/** The parent arrived, or the call is cancelled. */
export async function resoudreAppel(
  tx: Tx,
  auteur: Auteur,
  saisie: unknown,
): Promise<{ resolution: "parent_arrive" | "annule" }> {
  const { presenceId, resolution } = schemaResolution.parse(saisie);
  const [resolu] = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Appel" SET "resoluLe" = now(), resolution = ${resolution}, "resoluPar" = ${auteur.userId}
    WHERE "presenceId" = ${presenceId} AND "resoluLe" IS NULL
    RETURNING id`;
  if (!resolu) throw new AppelRefuse("Il n'y a plus d'appel en cours pour cet enfant.");
  await tracer(tx, auteur, presenceId, resolu.id, "appel_parent_resolu", { resolution });
  return { resolution };
}

/** Closes the open calls of children handed over, in the check-out's transaction. */
export async function resoudreAppelsAuRetrait(
  tx: Tx,
  auteur: Auteur,
  presenceIds: string[],
): Promise<void> {
  const resolus = await tx.$queryRaw<{ id: string; presenceId: string }[]>`
    UPDATE "Appel" SET "resoluLe" = now(), resolution = 'recupere', "resoluPar" = ${auteur.userId}
    WHERE "presenceId" = ANY(${presenceIds}::text[]) AND "resoluLe" IS NULL
    RETURNING id, "presenceId"`;
  for (const { id, presenceId } of resolus) {
    await tracer(tx, auteur, presenceId, id, "appel_parent_resolu", { resolution: "recupere" });
  }
}

export type AppelEnCours = {
  presenceId: string;
  prenom: string;
  matricule: string;
  classe: string;
  motif: MotifAppel;
  lieu: string;
  /** Minutes since the call (database clock). */
  depuisMinutes: number;
};

/** Open calls in the open sessions of the church, oldest first. */
export async function appelsEnCours(db: Pick<ClientDeBase, "$queryRaw">): Promise<AppelEnCours[]> {
  return db.$queryRaw<AppelEnCours[]>`
    SELECT p.id AS "presenceId", e.prenom, e.matricule, k.nom AS classe, a.motif, a.lieu,
           floor(extract(epoch FROM now() - a."creeLe") / 60)::int AS "depuisMinutes"
    FROM "Appel" a
    JOIN "Presence" p ON p.id = a."presenceId"
    JOIN "Session" s ON s.id = p."sessionId"
    JOIN "Enfant" e ON e.id = p."enfantId"
    JOIN "Classe" k ON k.id = p."classeId"
    WHERE a."resoluLe" IS NULL AND s.statut = 'OUVERTE'
    ORDER BY a."creeLe", e.prenom`;
}

/** The open call of a presence, if any. */
export async function appelOuvert(
  db: Pick<ClientDeBase, "$queryRaw">,
  presenceId: string,
): Promise<Pick<AppelEnCours, "motif" | "lieu" | "depuisMinutes"> | null> {
  const [appel] = await db.$queryRaw<Pick<AppelEnCours, "motif" | "lieu" | "depuisMinutes">[]>`
    SELECT motif, lieu, floor(extract(epoch FROM now() - "creeLe") / 60)::int AS "depuisMinutes"
    FROM "Appel" WHERE "presenceId" = ${presenceId} AND "resoluLe" IS NULL`;
  return appel ?? null;
}

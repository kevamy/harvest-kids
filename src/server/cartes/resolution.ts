import "server-only";
import { empreinteJeton, typeJeton } from "@/lib/jetons";
import type { ClientDeBase } from "@/lib/tenant";

/**
 * What a scanned value designates in the active church (RG-02, RG-03, RG-14, RG-16).
 * Strictly read-only: resolving never activates, revokes nor audits anything. A pending
 * card is reported as such; it is activated by "Remettre la carte" or by the first
 * check-in or check-out scan (cycle.ts).
 */
export type ResolutionJeton =
  | {
      statut: "active" | "en_attente";
      type: "famille" | "enfant";
      carteId: string;
      familleId: string;
      enfantId: string | null;
    }
  | { statut: "active"; type: "badge"; badgeId: string; membreId: string }
  | {
      statut:
        "revoquee" | "perimee" | "badge_remplace" | "badge_refuse" | "autre_eglise" | "inconnue";
    };

/** Messages shown after a scan (cahier §8). */
export const MESSAGES_SCAN = {
  revoquee:
    "Cette carte a été remplacée. Demandez la nouvelle carte au parent ou recherchez la famille.",
  perimee:
    "Cette carte a été remplacée. Demandez la nouvelle carte au parent ou recherchez la famille.",
  autre_eglise: "Cette carte n'appartient pas à cette église.",
  inconnue: "Carte inconnue. Vérifiez la carte ou recherchez la famille.",
  en_attente: "Carte en attente : elle sera activée à sa première utilisation.",
  badge_remplace:
    "Ce badge a été remplacé. Utilisez votre nouveau badge ou sélectionnez-vous dans la liste.",
  badge_refuse:
    "Ce badge n'est plus valide : son titulaire n'est plus moniteur actif dans cette église. Adressez-vous à un administrateur.",
} as const;

/**
 * Is this member an active monitor of the active church (member and account active, MONITEUR
 * role)? `Membre` is a platform table: the check is injected (src/server/plateforme/badges.ts).
 */
export type VerificationMoniteur = (membreId: string) => Promise<boolean>;

type Lecture = Pick<ClientDeBase, "carteFamille" | "badgeMoniteur" | "$queryRaw">;

export async function resoudreJeton(
  db: Lecture,
  jeton: string,
  estMoniteurActif: VerificationMoniteur,
): Promise<ResolutionJeton> {
  const valeur = jeton.trim();
  const type = typeJeton(valeur);
  if (!type) return { statut: "inconnue" };
  const empreinte = empreinteJeton(valeur);

  if (type === "badge") {
    const badge = await db.badgeMoniteur.findUnique({
      where: { tokenHash: empreinte },
      select: { id: true, membreId: true, revoqueLe: true },
    });
    if (badge) {
      // A badge revoked because its holder left the role reads as such, not as "replaced".
      if (!(await estMoniteurActif(badge.membreId))) return { statut: "badge_refuse" };
      if (badge.revoqueLe) return { statut: "badge_remplace" };
      return { statut: "active", type: "badge", badgeId: badge.id, membreId: badge.membreId };
    }
  } else {
    const carte = await db.carteFamille.findUnique({
      where: { tokenHash: empreinte },
      select: {
        id: true,
        familleId: true,
        enfantId: true,
        emiseLe: true,
        activeLe: true,
        revoqueeLe: true,
      },
    });
    if (carte) {
      if (carte.revoqueeLe) return { statut: "revoquee" };
      const designation = {
        type: carte.enfantId ? ("enfant" as const) : ("famille" as const),
        carteId: carte.id,
        familleId: carte.familleId,
        enfantId: carte.enfantId,
      };
      if (!carte.activeLe) return { statut: "en_attente", ...designation };
      if (await estPerimee(db, carte)) return { statut: "perimee" };
      return { statut: "active", ...designation };
    }
  }

  // Not in this church: RG-14 asks whether it exists in another one (a boolean only).
  const [ligne] = await db.$queryRaw<{ autre: boolean }[]>`
    SELECT hk_jeton_autre_eglise(${empreinte}) AS autre`;
  return { statut: ligne?.autre ? "autre_eglise" : "inconnue" };
}

/**
 * Active cards out of date (RG-16): a newer card covering the same children belongs to a
 * bulk reissue whose deadline has passed. A family card is replaced by any newer card of
 * the family; a child card by a newer card of the same child or a newer family card.
 * The deadline is compared with PostgreSQL's `now()`, one clock for the scan and the daily
 * task. `carteId`: that card only. Read-only, inside the active church (RLS).
 */
export async function cartesPerimees(
  db: Pick<ClientDeBase, "$queryRaw">,
  carteId: string | null = null,
): Promise<string[]> {
  const lignes = await db.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "CarteFamille" a
    WHERE a."revoqueeLe" IS NULL AND a."activeLe" IS NOT NULL
      AND (${carteId}::text IS NULL OR a.id = ${carteId}::text)
      AND EXISTS (
        SELECT 1 FROM "CarteFamille" n
        JOIN "ReemissionCartes" r ON r.id = n."reemissionId" AND r."egliseId" = n."egliseId"
        WHERE n."familleId" = a."familleId" AND n.id <> a.id AND n."revoqueeLe" IS NULL
          AND n."emiseLe" > a."emiseLe" AND r."dateLimite" < now()
          AND (a."enfantId" IS NULL OR n."enfantId" IS NULL OR n."enfantId" = a."enfantId")
      )
    ORDER BY a.id`;
  return lignes.map((l) => l.id);
}

export async function estPerimee(
  db: Pick<ClientDeBase, "$queryRaw">,
  carte: { id: string },
): Promise<boolean> {
  return (await cartesPerimees(db, carte.id)).length > 0;
}

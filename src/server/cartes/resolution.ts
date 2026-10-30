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
  | { statut: "active"; type: "badge"; membreId: string }
  | { statut: "revoquee" | "perimee" | "autre_eglise" | "inconnue" };

/** Messages shown after a scan (cahier §8). */
export const MESSAGES_SCAN = {
  revoquee:
    "Cette carte a été remplacée. Demandez la nouvelle carte au parent ou recherchez la famille.",
  perimee:
    "Cette carte a été remplacée. Demandez la nouvelle carte au parent ou recherchez la famille.",
  autre_eglise: "Cette carte n'appartient pas à cette église.",
  inconnue: "Carte inconnue. Vérifiez la carte ou recherchez la famille.",
  en_attente: "Carte en attente : elle sera activée à sa première utilisation.",
} as const;

/** Looks up an active monitor badge of the active church by fingerprint (platform table). */
export type RechercheBadge = (empreinte: string) => Promise<{ membreId: string } | null>;

type Lecture = Pick<ClientDeBase, "carteFamille" | "$queryRaw">;

export async function resoudreJeton(
  db: Lecture,
  jeton: string,
  rechercherBadge: RechercheBadge,
): Promise<ResolutionJeton> {
  const valeur = jeton.trim();
  const type = typeJeton(valeur);
  if (!type) return { statut: "inconnue" };
  const empreinte = empreinteJeton(valeur);

  if (type === "badge") {
    const badge = await rechercherBadge(empreinte);
    if (badge) return { statut: "active", type: "badge", membreId: badge.membreId };
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
 * An active card is out of date once a bulk reissue covering the same children has
 * passed its deadline (RG-16). Read-only: the daily task revokes it with an audit entry.
 */
export async function estPerimee(
  db: Lecture,
  carte: { id: string; familleId: string; enfantId: string | null; emiseLe: Date },
  maintenant = new Date(),
): Promise<boolean> {
  const remplacante = await db.carteFamille.findFirst({
    where: {
      id: { not: carte.id },
      familleId: carte.familleId,
      revoqueeLe: null,
      emiseLe: { gt: carte.emiseLe },
      reemission: { dateLimite: { lt: maintenant } },
      // A family card is replaced by any newer card of the family; a child card by a
      // newer card of the same child or a newer family card.
      ...(carte.enfantId ? { OR: [{ enfantId: carte.enfantId }, { enfantId: null }] } : {}),
    },
    select: { id: true },
  });
  return remplacante !== null;
}

import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { journaliser } from "@/lib/audit";
import { empreinteJeton, genererJetonCarte } from "@/lib/jetons";
import type { ClientDeBase, ContexteEglise } from "@/lib/tenant";
import { resoudreJeton, type RechercheBadge, type ResolutionJeton } from "./resolution";

/**
 * Card lifecycle (RG-16, ADR 0008): pending → active → revoked.
 *
 * - A new card is active at once when no active card covers its children (first card);
 *   otherwise it is pending and the card in circulation stays valid.
 * - A pending card is activated by "Remettre la carte" or by the first check-in or
 *   check-out scan; activation revokes, in the same transaction, every active card
 *   covering the same children.
 * - "Carte perdue" revokes the old card at once and issues an active one.
 *
 * Invariant: at most one active card covers a given child. The partial unique indexes
 * hold it within one card type; between the two types, the family row is locked
 * (SELECT … FOR UPDATE) for the whole operation.
 *
 * Every function here must run inside `db.$tx` (one transaction).
 */

type Tx = Pick<ClientDeBase, "carteFamille" | "famille" | "auditLog" | "$queryRaw">;
type Auteur = Pick<ContexteEglise, "userId" | "appareil">;

export class CarteImpossible extends Error {
  constructor(
    readonly raison: "famille_inconnue" | "famille_brouillon" | "carte_inconnue" | "pas_en_attente",
  ) {
    super(`Opération sur la carte impossible : ${raison}`);
    this.name = "CarteImpossible";
  }
}

export type Couverture = { familleId: string; enfantId?: string | null };

/** Locks the family row: card operations on one family are serialised. */
async function verrouillerFamille(tx: Tx, familleId: string) {
  const lignes = await tx.$queryRaw<{ finaliseeLe: Date | null }[]>`
    SELECT "finaliseeLe" FROM "Famille" WHERE id = ${familleId} FOR UPDATE`;
  const famille = lignes[0];
  if (!famille) throw new CarteImpossible("famille_inconnue");
  // Draft families (CSV import) have neither matricule nor card until finalised.
  if (!famille.finaliseeLe) throw new CarteImpossible("famille_brouillon");
}

/** Active cards covering the same children as `couverture` (both card types). */
function activesCouvrant(tx: Tx, { familleId, enfantId }: Couverture) {
  return tx.carteFamille.findMany({
    where: {
      familleId,
      revoqueeLe: null,
      activeLe: { not: null },
      // A family card covers every child; a child card covers its child and is covered
      // by the family card.
      ...(enfantId ? { OR: [{ enfantId }, { enfantId: null }] } : {}),
    },
    select: { id: true },
  });
}

async function revoquer(tx: Tx, auteur: Auteur, ids: string[], raison: string) {
  if (ids.length === 0) return;
  const maintenant = new Date();
  await tx.carteFamille.updateMany({
    where: { id: { in: ids }, revoqueeLe: null },
    data: { revoqueeLe: maintenant },
  });
  for (const id of ids) {
    await journaliser(tx, auteur, {
      action: "carte.revoquee",
      entite: "CarteFamille",
      entiteId: id,
      apres: { raison },
    });
  }
}

/**
 * Issues a card for a family (enfantId null) or a child. Returns the clear token, to be
 * printed at once: only its fingerprint is stored.
 */
export async function emettreCarte(
  tx: Tx,
  auteur: Auteur,
  couverture: Couverture,
  options: { reemissionId?: string } = {},
): Promise<{ carteId: string; jeton: string; active: boolean }> {
  await verrouillerFamille(tx, couverture.familleId);
  const enfantId = couverture.enfantId ?? null;

  // A pending card of the same coverage was never handed over: the new one replaces it.
  const enAttente = await tx.carteFamille.findMany({
    where: { familleId: couverture.familleId, enfantId, revoqueeLe: null, activeLe: null },
    select: { id: true },
  });
  await revoquer(
    tx,
    auteur,
    enAttente.map((c) => c.id),
    "remplacee_avant_remise",
  );

  const active = (await activesCouvrant(tx, couverture)).length === 0;
  const jeton = genererJetonCarte();
  const maintenant = new Date();
  const carte = await tx.carteFamille.create({
    data: {
      familleId: couverture.familleId,
      enfantId,
      tokenHash: empreinteJeton(jeton),
      emiseLe: maintenant,
      activeLe: active ? maintenant : null,
      reemissionId: options.reemissionId ?? null,
    } as Prisma.CarteFamilleUncheckedCreateInput, // egliseId is added by the scoped client
    select: { id: true },
  });
  await journaliser(tx, auteur, {
    action: "carte.emise",
    entite: "CarteFamille",
    entiteId: carte.id,
    apres: {
      type: enfantId ? "enfant" : "famille",
      active,
      reemissionId: options.reemissionId ?? null,
    },
  });
  return { carteId: carte.id, jeton, active };
}

/**
 * Activates a pending card and revokes every active card covering the same children,
 * in the caller's transaction, with audit entries. Used by "Remettre la carte".
 */
export async function activerCarte(
  tx: Tx,
  auteur: Auteur,
  carteId: string,
): Promise<{ revoquees: string[] }> {
  const carte = await tx.carteFamille.findUnique({
    where: { id: carteId },
    select: { familleId: true },
  });
  if (!carte) throw new CarteImpossible("carte_inconnue");
  await verrouillerFamille(tx, carte.familleId);

  // Read again under the lock: a concurrent activation may have changed it.
  const courante = await tx.carteFamille.findUnique({
    where: { id: carteId },
    select: { familleId: true, enfantId: true, activeLe: true, revoqueeLe: true },
  });
  if (!courante || courante.revoqueeLe || courante.activeLe) {
    throw new CarteImpossible("pas_en_attente");
  }

  const anciennes = (await activesCouvrant(tx, courante)).map((c) => c.id);
  // Revoke first: the partial unique indexes accept one active card per coverage.
  await revoquer(tx, auteur, anciennes, "remplacee");
  await tx.carteFamille.update({ where: { id: carteId }, data: { activeLe: new Date() } });
  await journaliser(tx, auteur, {
    action: "carte.activee",
    entite: "CarteFamille",
    entiteId: carteId,
    apres: { revoquees: anciennes },
  });
  return { revoquees: anciennes };
}

/**
 * First check-in or check-out scan (lot 2): resolves the token and, when the card is
 * pending, activates it in the same transaction. Never used by the verification scan.
 */
export async function activerAuPremierScan(
  tx: Tx,
  auteur: Auteur,
  jeton: string,
  rechercherBadge: RechercheBadge,
): Promise<ResolutionJeton> {
  const resolution = await resoudreJeton(tx, jeton, rechercherBadge);
  if (resolution.statut !== "en_attente") return resolution;
  await activerCarte(tx, auteur, resolution.carteId);
  return { ...resolution, statut: "active" };
}

/**
 * "Carte perdue": the card in circulation is revoked at once and a new, active card is
 * issued, in one transaction.
 */
export async function declarerCartePerdue(
  tx: Tx,
  auteur: Auteur,
  couverture: Couverture,
): Promise<{ carteId: string; jeton: string; revoquees: string[] }> {
  const { carteId, jeton, active } = await emettreCarte(tx, auteur, couverture);
  let revoquees: string[] = [];
  if (!active) ({ revoquees } = await activerCarte(tx, auteur, carteId));
  await journaliser(tx, auteur, {
    action: "carte.perdue",
    entite: "CarteFamille",
    entiteId: carteId,
    apres: { revoquees },
  });
  return { carteId, jeton, revoquees };
}

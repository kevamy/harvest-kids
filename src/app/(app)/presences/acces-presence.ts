import "server-only";
import { droitsPresence } from "@/lib/rbac";
import type { ClientEglise, ContexteEglise } from "@/lib/tenant";
import { nomsMembresEglise } from "@/server/plateforme/membres-session";
import { affecteALaPresence, fichePresence, type FichePresence } from "@/server/presences";
import {
  contactsUrgence,
  journalAppels,
  type ContactUrgence,
  type LigneJournalAppel,
} from "@/server/urgence";

export type Acces = { db: ClientEglise; contexte: ContexteEglise };

export type DroitsFiche = ReturnType<typeof droitsPresence>;

/**
 * The presence in the active church and the member's rights on it (droitsPresence). Null
 * when missing, in another church, or out of reach: the caller answers 404 in every case.
 */
export async function presenceAutorisee(
  { db, contexte }: Acces,
  presenceId: string,
): Promise<{ fiche: FichePresence; droits: DroitsFiche; affecte: boolean } | null> {
  const fiche = await fichePresence(db, presenceId);
  if (!fiche) return null;
  const affecte = await affecteALaPresence(db, presenceId, contexte.membreId);
  const droits = droitsPresence(contexte.roles, affecte);
  return droits.voir ? { fiche, droits, affecte } : null;
}

export type FicheDirect = {
  fiche: FichePresence;
  contacts: ContactUrgence[];
  journal: (LigneJournalAppel & { auteur: string })[];
  droits: DroitsFiche;
};

/** Everything the card shows, read in the active church. */
export async function lireFiche(
  acces: Acces,
  { fiche, droits }: { fiche: FichePresence; droits: DroitsFiche },
): Promise<FicheDirect> {
  const { presenceId } = fiche;
  const [contacts, journal] = await Promise.all([
    droits.appeler ? contactsUrgence(acces.db, presenceId) : Promise.resolve([]),
    journalAppels(acces.db, presenceId),
  ]);
  const noms = await nomsMembresEglise(acces.contexte, [...new Set(journal.map((j) => j.userId))]);
  return {
    fiche,
    droits,
    contacts,
    journal: journal.map((j) => ({ ...j, auteur: noms.get(j.userId) ?? "Compte supprimé" })),
  };
}

import "server-only";
import { droitsPresence } from "@/lib/rbac";
import type { ClientEglise, ContexteEglise } from "@/lib/tenant";
import { appelOuvert } from "@/server/appels";
import { lireParametres } from "@/server/parametres";
import { membresActifsEglise, nomsMembresEglise } from "@/server/plateforme/membres-session";
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
  /** Who may accompany the child to the infirmerie (reader first), when it can be sent. */
  accompagnants: { userId: string; nom: string }[];
  /** The parent call on the screen, if any. */
  appel: Awaited<ReturnType<typeof appelOuvert>>;
  /** Meeting places of the church (appels.lieux), when the parent may be called. */
  lieux: string[];
};

const peutPartir = (fiche: FichePresence) =>
  fiche.sessionOuverte && (fiche.statut === "PRESENT" || fiche.statut === "EN_SALLE");

/** Everything the card shows, read in the active church. */
export async function lireFiche(
  acces: Acces,
  { fiche, droits }: { fiche: FichePresence; droits: DroitsFiche },
): Promise<FicheDirect> {
  const { presenceId } = fiche;
  const [contacts, journal, membres, appel, parametres] = await Promise.all([
    droits.appeler ? contactsUrgence(acces.db, presenceId) : Promise.resolve([]),
    journalAppels(acces.db, presenceId),
    droits.envoyer && peutPartir(fiche) ? membresActifsEglise(acces.contexte) : Promise.resolve([]),
    appelOuvert(acces.db, presenceId),
    lireParametres(acces.db),
  ]);
  const noms = await nomsMembresEglise(acces.contexte, [...new Set(journal.map((j) => j.userId))]);
  const moi = acces.contexte.userId;
  return {
    fiche,
    droits,
    contacts,
    journal: journal.map((j) => ({ ...j, auteur: noms.get(j.userId) ?? "Compte supprimé" })),
    accompagnants: [
      ...membres.filter((m) => m.userId === moi),
      ...membres.filter((m) => m.userId !== moi),
    ],
    appel,
    lieux:
      droits.appeler && fiche.sessionOuverte && fiche.statut !== "RECUPERE"
        ? parametres["appels.lieux"]
        : [],
  };
}

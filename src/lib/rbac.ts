import type { Role } from "@/generated/prisma/enums";

/**
 * Who can do what inside a church (cahier §4). The single source of truth for
 * permissions: every Server Action and route checks it on the server.
 */
export const ACTIONS = [
  "tableau.direct",
  "familles.gerer",
  "familles.importer",
  "checkin",
  "checkout",
  "parent.appeler",
  "sessions.gerer",
  "classes.gerer",
  "classe.forcer",
  "classe.voir",
  // Every class list, and correcting an arrival in class after the 1-minute delay (§7.4).
  "salle.superviser",
  "infirmerie.envoyer",
  "infirmerie.gerer",
  "alertes.voir",
  "incident.declarer",
  // Incidents and their detail, with the photo of an exceptional retrieval (cahier §7.6).
  "incidents.voir",
  "rapports.voir",
  "audit.voir",
  "comptes.gerer",
  "eglise.parametrer",
  "donnees.purger",
  "ecran.voir",
] as const;

export type Action = (typeof ACTIONS)[number];

const DROITS: Record<Exclude<Role, "ADMIN">, readonly Action[]> = {
  RESPONSABLE: [
    "tableau.direct",
    // Cahier §7.1: family registration by ACCUEIL and RESPONSABLE.
    "familles.gerer",
    // CSV import of drafts (ADR 0013): ADMIN and RESPONSABLE, not ACCUEIL.
    "familles.importer",
    "sessions.gerer",
    "classes.gerer",
    "classe.forcer",
    "classe.voir",
    "salle.superviser",
    "alertes.voir",
    "incident.declarer",
    "incidents.voir",
    "rapports.voir",
    "audit.voir",
  ],
  ACCUEIL: [
    "tableau.direct",
    "familles.gerer",
    "checkin",
    "checkout",
    "parent.appeler",
    "alertes.voir",
  ],
  // Confirming an arrival in class comes from the assignment, not from a role (droitsSalle).
  MONITEUR: [
    "classe.voir",
    "infirmerie.envoyer",
    "parent.appeler",
    "alertes.voir",
    "incident.declarer",
  ],
  INFIRMERIE: ["infirmerie.gerer", "parent.appeler", "alertes.voir", "incident.declarer"],
  // Read-only call screen, without any personal data (RG-10).
  ECRAN: ["ecran.voir"],
};

export function peut(roles: readonly Role[], action: Action): boolean {
  if (roles.includes("ADMIN")) return action !== "ecran.voir";
  return roles.some((role) => role !== "ADMIN" && DROITS[role].includes(action));
}

export class ActionInterdite extends Error {
  constructor(readonly action: Action) {
    super(`Action non autorisée : ${action}`);
    this.name = "ActionInterdite";
  }
}

/**
 * A class list in a session (cahier §7.4, ADR 0015). The members assigned to the class for
 * the session confirm arrivals, whatever their role (monitors and reinforcements); a
 * RESPONSABLE or an ADMIN sees every class and corrects a confirmation after the 1-minute
 * delay; a MONITEUR only sees the class they are assigned to.
 */
export function droitsSalle(
  roles: readonly Role[],
  affecte: boolean,
): { voir: boolean; confirmer: boolean; corriger: boolean } {
  const superviser = peut(roles, "salle.superviser");
  return { voir: affecte || superviser, confirmer: affecte, corriger: superviser };
}

/** Throws unless one of the roles grants the action. */
export function exigerDroit(contexte: { roles: readonly Role[] }, action: Action): void {
  if (!peut(contexte.roles, action)) throw new ActionInterdite(action);
}

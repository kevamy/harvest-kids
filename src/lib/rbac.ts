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
    // Urgence button on any child's card (lot 3).
    "parent.appeler",
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
  // No rights: the call screen is a paired device, not an account (ADR 0018).
  ECRAN: [],
};

export function peut(roles: readonly Role[], action: Action): boolean {
  if (roles.includes("ADMIN")) return true;
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

/**
 * A child's presence card (lot 3, ADR 0019). The reception desk, the infirmerie, a RESPONSABLE
 * and an ADMIN reach every child of the church; a member assigned to the child's class in the
 * session reaches the children of that class only (a MONITEUR elsewhere gets a 404). Calling
 * the family (Urgence) also needs parent.appeler. A child goes to the infirmerie with a member
 * of their class, the infirmerie, a RESPONSABLE or an ADMIN (envoyer); the infirmerie receives
 * and sends back, as do a RESPONSABLE and an ADMIN (gerer).
 */
export function droitsPresence(
  roles: readonly Role[],
  affecte: boolean,
): { voir: boolean; appeler: boolean; envoyer: boolean; gerer: boolean; declarer: boolean } {
  const gerer = peut(roles, "infirmerie.gerer") || peut(roles, "salle.superviser");
  const voir = affecte || gerer || peut(roles, "tableau.direct");
  return {
    voir,
    appeler: voir && peut(roles, "parent.appeler"),
    envoyer: affecte || gerer,
    gerer,
    // An incident is declared from the card by whoever reaches the child and holds the right.
    declarer: voir && peut(roles, "incident.declarer"),
  };
}

/** Throws unless one of the roles grants the action. */
export function exigerDroit(contexte: { roles: readonly Role[] }, action: Action): void {
  if (!peut(contexte.roles, action)) throw new ActionInterdite(action);
}

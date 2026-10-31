import type { Role } from "@/generated/prisma/enums";

/**
 * Who can do what inside a church (cahier §4). The single source of truth for
 * permissions: every Server Action and route checks it on the server.
 */
export const ACTIONS = [
  "tableau.direct",
  "familles.gerer",
  "checkin",
  "checkout",
  "parent.appeler",
  "sessions.gerer",
  "classes.gerer",
  "classe.forcer",
  "classe.voir",
  "enfant.confirmerEnSalle",
  "infirmerie.envoyer",
  "infirmerie.gerer",
  "alertes.voir",
  "incident.declarer",
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
    "sessions.gerer",
    "classes.gerer",
    "classe.forcer",
    "classe.voir",
    "alertes.voir",
    "incident.declarer",
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
  MONITEUR: [
    "classe.voir",
    "enfant.confirmerEnSalle",
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

/** Throws unless one of the roles grants the action. */
export function exigerDroit(contexte: { roles: readonly Role[] }, action: Action): void {
  if (!peut(contexte.roles, action)) throw new ActionInterdite(action);
}

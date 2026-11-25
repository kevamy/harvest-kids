import type { Role } from "@/generated/prisma/enums";

/** Role names shown to people (cahier §4). Shared by the server and the browser. */
export const LIBELLES_ROLES: Record<Role, string> = {
  ADMIN: "Administrateur",
  RESPONSABLE: "Responsable",
  ACCUEIL: "Accueil",
  MONITEUR: "Moniteur",
  INFIRMERIE: "Infirmerie",
  ECRAN: "Écran d'appel",
};

/**
 * Roles given from Paramètres › Comptes. ECRAN stays in the enum without any use: the call
 * screen is a paired device, not an account (ADR 0018).
 */
export const ROLES_COMPTE = ["ADMIN", "RESPONSABLE", "ACCUEIL", "MONITEUR", "INFIRMERIE"] as const;

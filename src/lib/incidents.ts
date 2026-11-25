import type { TypeIncident } from "@/generated/prisma/enums";

/** Incident types (cahier §7.9), shared by the server and the browser. */
export const LIBELLES_INCIDENT: Record<TypeIncident, string> = {
  BLESSURE: "Blessure",
  MALAISE: "Malaise",
  COMPORTEMENT: "Comportement",
  ENFANT_INTROUVABLE: "Enfant introuvable",
  RETRAIT_NON_AUTORISE: "Retrait par une personne non autorisée",
  AUTRE: "Autre",
};

/** Types a member declares from a child's card (the exceptional retrieval has its own flow). */
export const TYPES_DECLARABLES = [
  "BLESSURE",
  "MALAISE",
  "COMPORTEMENT",
  "ENFANT_INTROUVABLE",
  "AUTRE",
] as const satisfies readonly TypeIncident[];
export type TypeDeclarable = (typeof TYPES_DECLARABLES)[number];

/** Call log and parent call values (lot 3), shared by the server and the browser. */

/** Why a parent is called to the screen (same list as the CHECK constraint Appel_motif). */
export const MOTIFS_APPEL = {
  pleurs: "Pleurs",
  change: "Change",
  soins: "Soins",
  comportement: "Comportement",
  autre: "Autre",
} as const;
export type MotifAppel = keyof typeof MOTIFS_APPEL;

/** How a parent call ends (CHECK Appel_resolution); "recupere" is set by the check-out. */
export const RESOLUTIONS_APPEL = {
  parent_arrive: "Parent arrivé",
  annule: "Appel annulé",
  recupere: "Enfant récupéré",
} as const;
export type ResolutionAppel = keyof typeof RESOLUTIONS_APPEL;

export const CANAUX_APPEL = ["tel", "whatsapp"] as const;
export type CanalAppel = (typeof CANAUX_APPEL)[number];

export const LIBELLES_CANAL: Record<CanalAppel, string> = { tel: "Appel", whatsapp: "WhatsApp" };

/** Same list as the CHECK constraint AppelTelephonique_resultat. */
export const RESULTATS_APPEL = {
  joint: "Joint",
  pas_de_reponse: "Pas de réponse",
  messagerie: "Messagerie",
} as const;
export type ResultatAppel = keyof typeof RESULTATS_APPEL;

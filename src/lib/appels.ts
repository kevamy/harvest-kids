/** Call log values (lot 3), shared by the server and the browser. */

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

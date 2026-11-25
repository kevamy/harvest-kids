"use server";

import { revalidatePath } from "next/cache";
import { IncidentRefuse, ajouterNoteIncident, cloturerIncident } from "@/server/incidents";
import { RefusMetier, executerAction, type ResultatAction } from "../../executer-action";

/**
 * Follow-up of an incident (lot 3), for the RESPONSABLE and the ADMIN (incidents.voir): a note
 * (append only), then the closure, set once. The declared content never changes.
 */

const enRefus = (erreur: unknown): never => {
  if (erreur instanceof IncidentRefuse) throw new RefusMetier(erreur.message);
  throw erreur;
};

export async function noterIncident(incidentId: unknown, texte: unknown): Promise<ResultatAction> {
  const id = typeof incidentId === "string" ? incidentId : "";
  const resultat = await executerAction("incidents.voir", ({ db, contexte }) =>
    db.$tx((tx) => ajouterNoteIncident(tx, contexte, { incidentId: id, texte })).catch(enRefus),
  );
  if (resultat.ok) revalidatePath(`/incidents/${id}`);
  return resultat;
}

export async function clore(incidentId: unknown): Promise<ResultatAction> {
  const id = typeof incidentId === "string" ? incidentId : "";
  const resultat = await executerAction("incidents.voir", ({ db, contexte }) =>
    db.$tx((tx) => cloturerIncident(tx, contexte, id)).catch(enRefus),
  );
  if (resultat.ok) {
    revalidatePath(`/incidents/${id}`);
    revalidatePath("/incidents");
  }
  return resultat;
}

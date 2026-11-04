import { formaterTelephone } from "@/lib/telephone";
import type { FicheFamille } from "@/server/familles";

// Shared by the server pages and the client form: no "use client", no server-only code.

/** A photo in the form: none, the stored one, or a new reduced one waiting to be sent. */
export type Photo = { cle: string } | { nouvelle: Blob; apercu: string } | null;

export type Tuteur = {
  uid: string;
  id?: string;
  prenom: string;
  nom: string;
  lien: string;
  telephone: string;
  telephone2: string;
  whatsapp: string;
  principal: boolean;
  autorise: boolean;
  photo: Photo;
};
export type Enfant = {
  uid: string;
  id?: string;
  prenom: string;
  nom: string;
  dateNaissance: string;
  sexe: "" | "F" | "M";
  alertes: string[];
  alerteDetail: string;
  notes: string;
  actif: boolean;
  photo: Photo;
};
export type Autre = {
  uid: string;
  id?: string;
  prenom: string;
  nom: string;
  lien: string;
  telephone: string;
  actif: boolean;
  photo: Photo;
};

export type ValeursFamille = {
  nom: string;
  notes: string;
  consentementDonnees: boolean;
  consentementPhotos: boolean;
  tuteurs: Tuteur[];
  enfants: Enfant[];
  autres: Autre[];
};

let compteur = 0;
const uid = () => `n${Date.now().toString(36)}${(compteur++).toString(36)}`;

export const nouveauTuteur = (principal: boolean): Tuteur => ({
  uid: uid(),
  prenom: "",
  nom: "",
  lien: "",
  telephone: "",
  telephone2: "",
  whatsapp: "",
  principal,
  autorise: true,
  photo: null,
});
export const nouvelEnfant = (nom = ""): Enfant => ({
  uid: uid(),
  prenom: "",
  nom,
  dateNaissance: "",
  sexe: "",
  alertes: [],
  alerteDetail: "",
  notes: "",
  actif: true,
  photo: null,
});
export const nouvelAutre = (): Autre => ({
  uid: uid(),
  prenom: "",
  nom: "",
  lien: "",
  telephone: "",
  actif: true,
  photo: null,
});

/** Empty form of a new registration: one main guardian, one child. */
export function valeursNouvelleFamille(): ValeursFamille {
  return {
    nom: "",
    notes: "",
    consentementDonnees: false,
    consentementPhotos: false,
    tuteurs: [nouveauTuteur(true)],
    enfants: [nouvelEnfant()],
    autres: [],
  };
}

const jour = (date: Date) => date.toISOString().slice(0, 10);

/** Form values of an existing family (edition, or finalisation of a draft). */
export function valeursFamille(fiche: FicheFamille): ValeursFamille {
  return {
    nom: fiche.nom,
    notes: fiche.notes ?? "",
    consentementDonnees: fiche.consentementDonnees !== null,
    consentementPhotos: fiche.consentementPhotos !== null,
    tuteurs: fiche.tuteurs.map((t) => ({
      uid: t.id,
      id: t.id,
      prenom: t.prenom,
      nom: t.nom,
      lien: t.lien,
      telephone: formaterTelephone(t.telephone),
      telephone2: t.telephone2 ? formaterTelephone(t.telephone2) : "",
      whatsapp: t.whatsapp ? formaterTelephone(t.whatsapp) : "",
      principal: t.principal,
      autorise: t.autorise?.actif ?? true,
      photo: t.autorise?.photoKey ? { cle: t.autorise.photoKey } : null,
    })),
    enfants: fiche.enfants.map((e) => ({
      uid: e.id,
      id: e.id,
      prenom: e.prenom,
      nom: e.nom,
      dateNaissance: jour(e.dateNaissance),
      sexe: e.sexe === "F" || e.sexe === "M" ? e.sexe : "",
      alertes: e.alertes,
      alerteDetail: e.alerteDetail ?? "",
      notes: e.notes ?? "",
      actif: e.actif,
      photo: e.photoKey ? { cle: e.photoKey } : null,
    })),
    autres: fiche.autorises.map((a) => ({
      uid: a.id,
      id: a.id,
      prenom: a.prenom,
      nom: a.nom,
      lien: a.lien,
      telephone: a.telephone ? formaterTelephone(a.telephone) : "",
      actif: a.actif,
      photo: a.photoKey ? { cle: a.photoKey } : null,
    })),
  };
}

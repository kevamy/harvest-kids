import type { Metadata } from "next";
import { lireParametres } from "@/server/parametres";
import { ALERTES_RAPIDES } from "@/server/familles";
import { contextePage } from "../../acces";
import { FormulaireFamille } from "../formulaire";
import { valeursNouvelleFamille } from "../valeurs";

export const metadata: Metadata = { title: "Inscrire une famille — Harvest Kids" };

export default async function NouvelleFamille() {
  const acces = await contextePage("familles.gerer");
  if (!acces) return null;
  const indicatif = (await lireParametres(acces.db))["telephone.indicatifParDefaut"];
  return (
    <div className="grid gap-6">
      <h1 className="m-0 font-display text-h1 font-semibold">Inscrire une famille</h1>
      <p className="m-0 max-w-3xl text-texte-doux">
        Les tuteurs, puis les enfants, puis les autres personnes autorisées à récupérer les enfants.
        Chaque personne autorisée doit avoir une photo.
      </p>
      <FormulaireFamille
        valeursInitiales={valeursNouvelleFamille()}
        libelleBouton="Enregistrer l'inscription"
        alertes={ALERTES_RAPIDES}
        indicatif={indicatif}
      />
    </div>
  );
}

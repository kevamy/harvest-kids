import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { lireParametres } from "@/server/parametres";
import { ALERTES_RAPIDES, lireFamille } from "@/server/familles";
import { contextePage } from "../../../acces";
import { FormulaireFamille } from "../../formulaire";
import { valeursFamille } from "../../valeurs";

export const metadata: Metadata = { title: "Modifier une famille — Harvest Kids" };

export default async function ModifierFamille({ params }: PageProps<"/familles/[id]/modifier">) {
  const acces = await contextePage("familles.gerer");
  if (!acces) return null;
  // A family of another church is invisible (scoped client): same 404 as a missing one.
  const fiche = await lireFamille(acces.db, (await params).id);
  if (!fiche) notFound();
  const indicatif = (await lireParametres(acces.db))["telephone.indicatifParDefaut"];
  const brouillon = fiche.finaliseeLe === null;

  return (
    <div className="grid gap-6">
      <h1 className="m-0 font-display text-h1 font-semibold">
        {brouillon ? `Finaliser la famille ${fiche.nom}` : `Modifier la famille ${fiche.nom}`}
      </h1>
      {brouillon ? (
        <p className="m-0 max-w-3xl text-texte-doux">
          Famille importée : recueillez le consentement daté du tuteur et prenez la photo d&apos;au
          moins une personne autorisée. Les matricules sont attribués à la finalisation.
        </p>
      ) : null}
      <FormulaireFamille
        familleId={fiche.id}
        valeursInitiales={valeursFamille(fiche)}
        libelleBouton={brouillon ? "Finaliser l'inscription" : "Enregistrer les modifications"}
        alertes={ALERTES_RAPIDES}
        indicatif={indicatif}
      />
    </div>
  );
}

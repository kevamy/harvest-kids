import type { Metadata } from "next";
import { NotchCard } from "@/components/hk/notch-card";
import { FUSEAUX_PROPOSES } from "@/server/plateforme/eglises";
import { profilEglise } from "@/server/plateforme/profil-eglise";
import { contextePage } from "../../acces";
import { EnteteSection } from "../entete";
import { formaterTelephone } from "@/lib/telephone";
import { lireParametres } from "@/server/parametres";
import { FormulaireIndicatif, FormulaireLogo, FormulaireProfil } from "./formulaires";

export const metadata: Metadata = { title: "Église — Paramètres — Harvest Kids" };

export default async function ParametresEglise() {
  const acces = await contextePage("eglise.parametrer");
  if (!acces) return null;
  const [profil, parametres] = await Promise.all([
    profilEglise(acces.contexte),
    lireParametres(acces.db),
  ]);
  const indicatif = parametres["telephone.indicatifParDefaut"];

  return (
    <div className="grid gap-6">
      <EnteteSection
        titre="Église"
        description="Ces informations figurent sur les cartes, les badges et l'écran d'appel."
      />
      <NotchCard couleur="blanc">
        <h2 className="m-0 mb-5 font-display text-h2 font-semibold">Profil</h2>
        <FormulaireProfil
          fuseaux={FUSEAUX_PROPOSES}
          indicatif={indicatif}
          valeurs={{
            nom: profil.nom,
            adresse: profil.adresse ?? "",
            telephoneAccueil: profil.telephoneAccueil
              ? formaterTelephone(profil.telephoneAccueil)
              : "",
            fuseau: profil.fuseau,
          }}
        />
      </NotchCard>
      <NotchCard couleur="blanc">
        <h2 className="m-0 mb-5 font-display text-h2 font-semibold">Téléphones</h2>
        <FormulaireIndicatif indicatif={indicatif} />
      </NotchCard>
      <div className="grid gap-6 md:grid-cols-2">
        <NotchCard couleur="blanc">
          <h2 className="m-0 mb-2 font-display text-h2 font-semibold">Logo</h2>
          <p className="mt-0 mb-5 text-texte-doux">
            Pour les fonds clairs : cartes, badges, pages de l&apos;application.
          </p>
          <FormulaireLogo variante="principal" cle={profil.logoKey} nomEglise={profil.nom} />
        </NotchCard>
        <NotchCard couleur="blanc">
          <h2 className="m-0 mb-2 font-display text-h2 font-semibold">Logo clair</h2>
          <p className="mt-0 mb-5 text-texte-doux">
            Facultatif, pour les fonds sombres : en-tête et écran d&apos;appel.
          </p>
          <FormulaireLogo variante="clair" cle={profil.logoClairKey} nomEglise={profil.nom} />
        </NotchCard>
      </div>
    </div>
  );
}

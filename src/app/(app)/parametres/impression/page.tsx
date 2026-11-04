import type { Metadata } from "next";
import { NotchCard } from "@/components/hk/notch-card";
import { formaterTelephone } from "@/lib/telephone";
import { FORMATS } from "@/server/impression/formats";
import { lireParametres } from "@/server/parametres";
import { contextePage } from "../../acces";
import { EnteteSection } from "../entete";
import { profilEglise } from "@/server/plateforme/profil-eglise";
import { ApercusCartes } from "./apercus";
import { FormulaireImpression } from "./formulaire";
import { FormulaireTextesCarte } from "./textes";

export const metadata: Metadata = { title: "Impression — Paramètres — Harvest Kids" };

export default async function ParametresImpression() {
  const acces = await contextePage("eglise.parametrer");
  if (!acces) return null;
  const [{ impression, "cartes.textes": textes }, eglise] = await Promise.all([
    lireParametres(acces.db),
    profilEglise(acces.contexte),
  ]);

  return (
    <div className="grid gap-6">
      <EnteteSection
        titre="Impression des cartes"
        description="L'église imprime elle-même ses cartes et ses badges. Le format choisi ici est proposé par défaut ; il reste modifiable à chaque impression."
      />
      <NotchCard couleur="blanc">
        <h2 className="m-0 mb-2 font-display text-h2 font-semibold">Aperçu des formats</h2>
        <p className="mt-0 mb-5 text-texte-doux">
          À la même échelle, avec le logo de l&apos;église et une famille fictive.
        </p>
        <ApercusCartes
          formats={FORMATS}
          eglise={{
            nom: eglise.nom,
            logoKey: eglise.logoKey,
            telephoneAccueil: eglise.telephoneAccueil,
            textes,
          }}
          rectoSeul={!impression.rectoVerso}
        />
      </NotchCard>
      <NotchCard couleur="blanc">
        <FormulaireImpression formats={FORMATS} valeurs={impression} />
      </NotchCard>
      <NotchCard couleur="blanc">
        <FormulaireTextesCarte
          valeurs={textes}
          telephoneAccueil={
            eglise.telephoneAccueil ? formaterTelephone(eglise.telephoneAccueil) : null
          }
        />
      </NotchCard>
    </div>
  );
}

import type { Metadata } from "next";
import { NotchCard } from "@/components/hk/notch-card";
import { FORMATS } from "@/server/impression/formats";
import { lireParametres } from "@/server/parametres";
import { contextePage } from "../../acces";
import { EnteteSection } from "../entete";
import { FormulaireImpression } from "./formulaire";

export const metadata: Metadata = { title: "Impression — Paramètres — Harvest Kids" };

export default async function ParametresImpression() {
  const acces = await contextePage("eglise.parametrer");
  if (!acces) return null;
  const { impression } = await lireParametres(acces.db);

  return (
    <div className="grid gap-6">
      <EnteteSection
        titre="Impression des cartes"
        description="L'église imprime elle-même ses cartes et ses badges. Le format choisi ici est proposé par défaut ; il reste modifiable à chaque impression."
      />
      <NotchCard couleur="blanc">
        <FormulaireImpression formats={FORMATS} valeurs={impression} />
      </NotchCard>
    </div>
  );
}

import type { Metadata } from "next";
import { NotchCard } from "@/components/hk/notch-card";
import { lireParametres } from "@/server/parametres";
import { contextePage } from "../../acces";
import { EnteteSection } from "../entete";
import { FormulaireModeCarte } from "./formulaire";

export const metadata: Metadata = { title: "Cartes — Paramètres — Harvest Kids" };

export default async function ParametresCartes() {
  const acces = await contextePage("eglise.parametrer");
  if (!acces) return null;
  const parametres = await lireParametres(acces.db);

  return (
    <div className="grid gap-6">
      <EnteteSection
        titre="Cartes"
        description="Choisissez si l'église remet une carte par famille ou une carte par enfant."
      />
      <NotchCard couleur="blanc">
        <FormulaireModeCarte modeActuel={parametres["cartes.mode"]} />
      </NotchCard>
    </div>
  );
}

import type { Metadata } from "next";
import { NotchCard } from "@/components/hk/notch-card";
import { lireParametres } from "@/server/parametres";
import { contextePage } from "../../acces";
import { EnteteSection } from "../entete";
import { FormulaireDelaiPurge } from "./formulaire";

export const metadata: Metadata = { title: "Familles à compléter — Paramètres — Harvest Kids" };

export default async function ParametresFamilles() {
  const acces = await contextePage("eglise.parametrer");
  if (!acces) return null;
  const parametres = await lireParametres(acces.db);

  return (
    <div className="grid gap-6">
      <EnteteSection
        titre="Familles à compléter"
        description="Les familles importées restent en brouillon, sans matricule ni carte, jusqu'à leur finalisation à l'accueil. Passé ce délai, un brouillon non finalisé est supprimé automatiquement."
      />
      <NotchCard couleur="blanc">
        <FormulaireDelaiPurge jours={parametres["familles.delaiPurgeBrouillonsJours"]} />
      </NotchCard>
    </div>
  );
}

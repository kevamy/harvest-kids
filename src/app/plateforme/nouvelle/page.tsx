import type { Metadata } from "next";
import { NotchCard } from "@/components/hk/notch-card";
import { FUSEAUX_PROPOSES } from "@/server/plateforme/eglises";
import { sessionPagePlateforme } from "../acces";
import { FormulaireNouvelleEglise } from "../composants";

export const metadata: Metadata = { title: "Créer une église — Harvest Kids" };

export default async function NouvelleEglise() {
  if (!(await sessionPagePlateforme())) return null;
  return (
    <NotchCard couleur="blanc" className="mx-auto max-w-2xl">
      <h1 className="m-0 font-display text-h2 font-semibold">Créer une église</h1>
      <p className="mt-2 mb-6 text-texte-doux">
        Les classes et les cultes par défaut sont créés avec l&apos;église ; son administrateur
        pourra les modifier.
      </p>
      <FormulaireNouvelleEglise fuseaux={FUSEAUX_PROPOSES} />
    </NotchCard>
  );
}

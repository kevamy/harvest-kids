import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotchCard } from "@/components/hk/notch-card";
import { AccesRefuse, getEgliseActive } from "@/lib/tenant";
import { FormulaireDefinitionPin } from "../formulaires";

export const metadata: Metadata = { title: "Code PIN — Harvest Kids" };

export default async function DefinirCodePin() {
  try {
    await getEgliseActive();
  } catch (erreur) {
    if (erreur instanceof AccesRefuse) redirect("/");
    throw erreur;
  }
  return (
    <NotchCard couleur="blanc">
      <h1 className="m-0 font-display text-h2 font-semibold">Choisissez votre code PIN</h1>
      <p className="mt-2 mb-6 text-texte-doux">
        La tablette se verrouille après 15 minutes sans activité. Ce code personnel à 6 chiffres la
        déverrouille. Ne le communiquez à personne.
      </p>
      <FormulaireDefinitionPin />
    </NotchCard>
  );
}

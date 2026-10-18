import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotchCard } from "@/components/hk/notch-card";
import { getSessionCourante } from "@/lib/session";
import { FormulaireConnexion } from "../formulaires";

export const metadata: Metadata = { title: "Connexion — Harvest Kids" };

export default async function Connexion() {
  if (await getSessionCourante()) redirect("/");
  return (
    <NotchCard couleur="blanc">
      <h1 className="m-0 font-display text-h2 font-semibold">Connexion</h1>
      <p className="mt-2 mb-6 text-texte-doux">
        Connectez-vous avec l&apos;e-mail ou le téléphone donné par votre église.
      </p>
      <FormulaireConnexion />
    </NotchCard>
  );
}

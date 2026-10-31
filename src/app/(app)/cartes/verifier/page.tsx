import type { Metadata } from "next";
import { NotchCard } from "@/components/hk/notch-card";
import { peut } from "@/lib/rbac";
import { contextePage } from "../../acces";
import { Verification } from "./verification";

export const metadata: Metadata = { title: "Vérifier une carte — Harvest Kids" };

export default async function VerifierCarte() {
  const acces = await contextePage("checkin", "familles.gerer");
  if (!acces) return null;
  return (
    <div className="grid gap-6">
      <h1 className="m-0 font-display text-h1 font-semibold">Vérifier une carte</h1>
      <p className="m-0 max-w-3xl text-texte-doux">
        Vérifier une carte ne change rien : une nouvelle carte reste en attente jusqu&apos;à sa
        remise à la famille ou à sa première utilisation.
      </p>
      <NotchCard couleur="blanc">
        <Verification peutRemettre={peut(acces.contexte.roles, "familles.gerer")} />
      </NotchCard>
    </div>
  );
}

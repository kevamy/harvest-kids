import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { NotchCard } from "@/components/hk/notch-card";

export const metadata: Metadata = { title: "Hors connexion — Harvest Kids" };

export default function HorsConnexion() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <NotchCard couleur="blanc" coin={<WifiOff aria-hidden className="size-7 text-alerte" />}>
        <h1 className="m-0 font-display text-h2 font-semibold">Hors connexion</h1>
        <p className="mt-3 max-w-prose">
          La tablette n&apos;est plus connectée. Aucune action ne peut être enregistrée pour
          l&apos;instant. Vérifiez le Wi-Fi ou la 4G, puis rechargez la page.
        </p>
      </NotchCard>
    </main>
  );
}

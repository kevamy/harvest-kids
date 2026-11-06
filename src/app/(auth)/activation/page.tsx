import type { Metadata } from "next";
import { NotchCard } from "@/components/hk/notch-card";
import { FormulaireActivation } from "./formulaire";

// A one-time link page: never indexed, never sent as a referrer (the proxy also sends
// Referrer-Policy: no-referrer for this path). No third-party script on it.
export const metadata: Metadata = {
  title: "Choisir mon mot de passe — Harvest Kids",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Public page of the activation and reset links (ADR 0014). The token is in the URL
 * fragment: the server never sees it in a page request, only in the form's POST.
 */
export default function Activation() {
  return (
    <NotchCard couleur="blanc">
      <h1 className="m-0 font-display text-h2 font-semibold">Choisir mon mot de passe</h1>
      <p className="mt-2 mb-6 text-texte-doux">
        Choisissez le mot de passe de votre compte Harvest Kids. Ce lien ne sert qu&apos;une fois.
      </p>
      <FormulaireActivation />
    </NotchCard>
  );
}

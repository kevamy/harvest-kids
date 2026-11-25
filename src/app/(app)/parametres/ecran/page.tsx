import type { Metadata } from "next";
import { listerEcransEglise } from "@/server/plateforme/ecran";
import { contextePage } from "../../acces";
import { EnteteSection } from "../entete";
import { Ecrans } from "./ecrans";

export const metadata: Metadata = { title: "Écran d'appel — Paramètres — Harvest Kids" };

/**
 * Call screens of the church (ADR 0018), for the ADMIN: add a named screen (its pairing link
 * is shown once), see when each was paired and last seen, revoke one.
 */
export default async function ParametresEcran() {
  const acces = await contextePage("eglise.parametrer");
  if (!acces) return null;
  const ecrans = await listerEcransEglise(acces.contexte);

  return (
    <div className="grid gap-6">
      <EnteteSection
        titre="Écran d'appel"
        description="L'écran de la salle affiche les numéros des enfants dont le parent est attendu, et ceux qui sont à l'infirmerie, jamais leur nom. Ajoutez un écran, puis ouvrez son lien sur l'appareil qui l'affiche : l'appareil reste appairé jusqu'à ce que vous le retiriez."
      />
      <Ecrans ecrans={ecrans} />
    </div>
  );
}

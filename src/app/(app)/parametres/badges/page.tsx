import type { Metadata } from "next";
import { NotchCard } from "@/components/hk/notch-card";
import { moniteursDeLEglise } from "@/server/plateforme/badges";
import { profilEglise } from "@/server/plateforme/profil-eglise";
import { contextePage } from "../../acces";
import { EnteteSection } from "../entete";
import { BadgesMoniteurs } from "./badges";

export const metadata: Metadata = { title: "Badges moniteurs — Paramètres — Harvest Kids" };

export default async function ParametresBadges() {
  const acces = await contextePage("comptes.gerer");
  if (!acces) return null;
  const [moniteurs, { fuseau }] = await Promise.all([
    moniteursDeLEglise(acces.contexte),
    profilEglise(acces.contexte),
  ]);
  // Dates in the church's time zone (RG-12).
  const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: fuseau });

  return (
    <div className="grid gap-6">
      <EnteteSection
        titre="Badges moniteurs"
        description="Chaque moniteur scanne son badge pour enregistrer sa présence. Les badges sont imprimés dans le format et avec les faces des réglages d'impression des cartes."
      />
      <NotchCard couleur="blanc">
        <BadgesMoniteurs
          moniteurs={moniteurs.map((m) => ({
            membreId: m.membreId,
            nom: m.nom,
            badgeEmisLe: m.badgeEmisLe ? date.format(m.badgeEmisLe) : null,
          }))}
        />
      </NotchCard>
    </div>
  );
}

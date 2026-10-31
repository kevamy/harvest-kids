import type { Metadata } from "next";
import { NotchCard } from "@/components/hk/notch-card";
import { ajouterJours, jourLocal } from "@/lib/fuseau";
import { DELAI_MAX_JOURS, apercuReemission } from "@/server/impression/reemission";
import { profilEglise } from "@/server/plateforme/profil-eglise";
import { contextePage } from "../../acces";
import { EnteteSection } from "../entete";
import { FormulaireModeCarte } from "./formulaire";
import { ReemissionCartes } from "./reemission";

export const metadata: Metadata = { title: "Cartes — Paramètres — Harvest Kids" };

const MODES = { FAMILLE: "une carte par famille", ENFANT: "une carte par enfant" } as const;

export default async function ParametresCartes() {
  const acces = await contextePage("eglise.parametrer");
  if (!acces) return null;
  const [apercu, { fuseau }, reemissions] = await Promise.all([
    apercuReemission(acces.db),
    profilEglise(acces.contexte),
    acces.db.reemissionCartes.findMany({
      orderBy: { creeLe: "desc" },
      take: 5,
      select: {
        id: true,
        creeLe: true,
        mode: true,
        dateLimite: true,
        _count: { select: { cartes: true } },
      },
    }),
  ]);

  // Dates in the church's time zone (RG-12).
  const instant = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: fuseau,
  });
  const jour = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: fuseau });
  const aujourdhui = jourLocal(new Date(), fuseau);

  return (
    <div className="grid gap-6">
      <EnteteSection
        titre="Cartes"
        description="Choisissez si l'église remet une carte par famille ou une carte par enfant."
      />
      <NotchCard couleur="blanc">
        <FormulaireModeCarte modeActuel={apercu.mode} />
      </NotchCard>
      <NotchCard couleur="blanc">
        <ReemissionCartes
          mode={MODES[apercu.mode]}
          familles={apercu.familles}
          cartes={apercu.cartes}
          demain={ajouterJours(aujourdhui, 1)}
          dernierJourMax={ajouterJours(aujourdhui, DELAI_MAX_JOURS)}
          historique={reemissions.map((r) => ({
            id: r.id,
            creeLe: instant.format(r.creeLe),
            mode: MODES[r.mode],
            // dateLimite: midnight after the last valid day.
            dernierJour: r.dateLimite ? jour.format(new Date(r.dateLimite.getTime() - 1)) : null,
            cartes: r._count.cartes,
          }))}
        />
      </NotchCard>
    </div>
  );
}

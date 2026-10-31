import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { NotchCard } from "@/components/hk/notch-card";
import { peut, type Action } from "@/lib/rbac";
import { contextePage } from "../acces";

export const metadata: Metadata = { title: "Paramètres — Harvest Kids" };

const SECTIONS: { href: string; titre: string; description: string; action: Action }[] = [
  {
    href: "/parametres/eglise",
    titre: "Église",
    description: "Nom, coordonnées, fuseau horaire, téléphone de l'accueil et logos.",
    action: "eglise.parametrer",
  },
  {
    href: "/parametres/cartes",
    titre: "Cartes",
    description: "Une carte par famille ou une carte par enfant.",
    action: "eglise.parametrer",
  },
  {
    href: "/parametres/classes",
    titre: "Classes et tranches d'âge",
    description: "Noms, âges, salles, capacité et nombre minimum de moniteurs.",
    action: "classes.gerer",
  },
  {
    href: "/parametres/impression",
    titre: "Impression des cartes",
    description: "Format par défaut, recto seul ou recto-verso.",
    action: "eglise.parametrer",
  },
  {
    href: "/parametres/badges",
    titre: "Badges moniteurs",
    description: "Badges à scanner pour la présence des moniteurs, aux formats des cartes.",
    action: "comptes.gerer",
  },
  {
    href: "/parametres/familles",
    titre: "Familles à compléter",
    description: "Délai avant la suppression des familles importées non finalisées.",
    action: "eglise.parametrer",
  },
];

export default async function Parametres() {
  const acces = await contextePage("eglise.parametrer", "classes.gerer", "comptes.gerer");
  if (!acces) return null;
  const sections = SECTIONS.filter((s) => peut(acces.contexte.roles, s.action));

  return (
    <div className="grid gap-6">
      <h1 className="m-0 font-display text-h1 font-semibold">Paramètres</h1>
      <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
        {sections.map((section) => (
          <li key={section.href}>
            <Link href={section.href} className="block h-full no-underline">
              <NotchCard as="div" couleur="blanc" className="flex h-full items-center gap-4">
                <span className="grid flex-1 gap-1">
                  <span className="font-display text-h3 font-semibold text-nuit">
                    {section.titre}
                  </span>
                  <span className="text-texte-doux">{section.description}</span>
                </span>
                <ChevronRight aria-hidden className="size-6 shrink-0 text-bleu" />
              </NotchCard>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

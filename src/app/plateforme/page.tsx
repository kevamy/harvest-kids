import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { NotchCard } from "@/components/hk/notch-card";
import { Button } from "@/components/ui/button";
import { eglisesDeLaPlateforme } from "@/server/plateforme/console";
import { sessionPagePlateforme } from "./acces";
import { BoutonStatut } from "./composants";

export const metadata: Metadata = { title: "Plateforme — Harvest Kids" };

export default async function Plateforme() {
  if (!(await sessionPagePlateforme())) return null;
  const eglises = await eglisesDeLaPlateforme();
  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="m-0 font-display text-h1 font-semibold">Églises</h1>
        <Button asChild variant="bleu">
          <Link href="/plateforme/nouvelle">
            <Plus aria-hidden />
            Créer une église
          </Link>
        </Button>
      </div>

      <ul className="grid gap-4" aria-label="Églises de la plateforme">
        {eglises.map((eglise) => (
          <li key={eglise.id}>
            <NotchCard couleur="blanc" as="article" aria-label={eglise.nom}>
              <h2 className="m-0 font-display text-h3 font-semibold">{eglise.nom}</h2>
              <p className="mt-1 text-label text-texte-doux">
                /ecran/{eglise.slug} · {eglise.membres} compte{eglise.membres > 1 ? "s" : ""} ·{" "}
                {eglise.statut === "ACTIVE" ? "Active" : "Suspendue"}
              </p>
              <div className="mt-4">
                <BoutonStatut egliseId={eglise.id} statut={eglise.statut} nom={eglise.nom} />
              </div>
            </NotchCard>
          </li>
        ))}
      </ul>
    </div>
  );
}

import type { Metadata } from "next";
import { Download } from "lucide-react";
import { NotchCard } from "@/components/hk/notch-card";
import { Button } from "@/components/ui/button";
import { COLONNES, ENFANTS_MAX, LIGNES_MAX } from "@/server/import-familles/analyse";
import { contextePage } from "../../acces";
import { Importeur } from "./importeur";

export const metadata: Metadata = { title: "Importer des familles — Harvest Kids" };
// Up to 2,000 lines imported in one transaction (Server Action of this page).
export const maxDuration = 120;

const OBLIGATOIRES = new Set(["Prénom de l'enfant", "Date de naissance"]);

/** CSV import of families as drafts (cahier §7.1, ADR 0013). ADMIN and RESPONSABLE. */
export default async function ImporterFamilles() {
  const acces = await contextePage("familles.importer");
  if (!acces) return null;
  return (
    <div className="grid gap-6">
      <h1 className="m-0 font-display text-h1 font-semibold">Importer des familles</h1>
      <p className="m-0 max-w-3xl text-texte-doux">
        Reprise d&apos;une liste existante (Harvest, tableur). Les familles importées sont des
        brouillons : sans matricule ni carte, elles apparaissent dans « À compléter » et se
        finalisent à l&apos;accueil, avec les photos et les consentements.
      </p>

      <NotchCard couleur="blanc">
        <h2 className="m-0 mb-2 font-display text-h2 font-semibold">Préparer le fichier</h2>
        <ul className="mt-0 mb-4 grid gap-1 pl-5">
          <li>Une ligne par enfant, {LIGNES_MAX.toLocaleString("fr-FR")} lignes au plus.</li>
          <li>
            Les enfants qui ont le même nom de famille et le même téléphone du tuteur 1 (ou, sans
            téléphone, le même tuteur 1) forment une famille, de {ENFANTS_MAX} enfants au plus.
          </li>
          <li>
            Dates de naissance au format JJ/MM/AAAA (05/03/2019 ou 5/3/2019), avec l&apos;année
            complète.
          </li>
          <li>
            Fichier CSV séparé par des points-virgules ou des virgules, enregistré depuis un tableur
            (« CSV UTF-8 » de préférence).
          </li>
        </ul>
        <p className="mt-0 mb-2 font-bold">Colonnes du modèle</p>
        <p className="mt-0 mb-4 text-label">
          {COLONNES.map((c, i) => (
            <span key={c.cle}>
              {i > 0 ? " · " : ""}
              {c.entete}
              {OBLIGATOIRES.has(c.entete) ? " (obligatoire)" : ""}
            </span>
          ))}
        </p>
        <Button asChild variant="ghost">
          <a href="/api/familles/modele-import" download="modele-import-familles.csv">
            <Download aria-hidden />
            Télécharger le modèle
          </a>
        </Button>
      </NotchCard>

      <Importeur />
    </div>
  );
}

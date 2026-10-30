import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";
import { NotchCard } from "@/components/hk/notch-card";
import { ageLisible, analyserTranches, listerClasses } from "@/server/classes";
import { contextePage } from "../../acces";
import { EnteteSection } from "../entete";
import { FormulaireClasse } from "./formulaire";

export const metadata: Metadata = { title: "Classes — Paramètres — Harvest Kids" };

const plage = (de: number, a: number) =>
  de === a ? ageLisible(de) : `de ${ageLisible(de)} à ${ageLisible(a)}`;

export default async function ParametresClasses() {
  const acces = await contextePage("classes.gerer");
  if (!acces) return null;
  const classes = await listerClasses(acces.db);
  const analyse = analyserTranches(classes.filter((c) => c.active));
  const signalements = [
    ...analyse.chevauchements.map(
      (c) => `${c.classes[0]} et ${c.classes[1]} se chevauchent ${plage(c.deMois, c.aMois)}.`,
    ),
    ...analyse.trous.map((t) => `Aucune classe active ${plage(t.deMois, t.aMois)}.`),
  ];

  return (
    <div className="grid gap-6">
      <EnteteSection
        titre="Classes et tranches d'âge"
        description="Les âges sont en mois, bornes incluses : de 36 à 71 mois couvre les enfants de 3 ans à 5 ans et 11 mois. Une tranche modifiée s'applique aux check-in suivants ; elle ne déplace aucune présence."
      />
      <section aria-labelledby="analyse" className="grid gap-3">
        <h2 id="analyse" className="sr-only">
          Vérification des tranches
        </h2>
        {signalements.length > 0 ? (
          <div role="note" className="flex gap-3 rounded-md bg-soleil px-5 py-4 text-nuit">
            <TriangleAlert aria-hidden className="mt-0.5 size-6 shrink-0" />
            <div className="grid gap-1">
              <p className="m-0 font-bold">À vérifier (l&apos;enregistrement reste possible) :</p>
              <ul className="m-0 pl-5" data-testid="signalements-tranches">
                {signalements.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="m-0 rounded-md bg-bleu-voile px-5 py-4 text-nuit">
            Les tranches des classes actives se suivent sans chevauchement ni trou.
          </p>
        )}
      </section>
      <ul className="m-0 grid list-none gap-4 p-0">
        {classes.map((classe) => (
          <li key={classe.id}>
            <NotchCard couleur="blanc" aria-label={`Classe ${classe.nom}`}>
              <h2 className="m-0 mb-5 font-display text-h2 font-semibold">
                {classe.nom}
                {classe.active ? null : (
                  <span className="ml-3 align-middle text-label font-bold text-texte-doux">
                    inactive
                  </span>
                )}
              </h2>
              <FormulaireClasse classe={classe} />
            </NotchCard>
          </li>
        ))}
      </ul>
      <NotchCard couleur="blanc">
        <h2 className="m-0 mb-5 font-display text-h2 font-semibold">Ajouter une classe</h2>
        <FormulaireClasse ordreSuivant={(classes.at(-1)?.ordre ?? 0) + 1} />
      </NotchCard>
    </div>
  );
}

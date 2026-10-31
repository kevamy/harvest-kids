"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { MatriculeBadge } from "@/components/hk/matricule-badge";
import { Scanner } from "@/components/hk/scanner";
import { Button } from "@/components/ui/button";
import { MessageErreur } from "@/components/ui/champ";
import { appelerAction } from "@/lib/appel-action";
import { remettreCarte, verifierCarte, type ResultatVerification } from "../actions";

/** Read-only scan; "Remettre la carte" is an explicit, separate action. */
export function Verification({ peutRemettre }: { peutRemettre: boolean }) {
  const [resultat, setResultat] = useState<ResultatVerification | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [remise, setRemise] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  const verifier = (jeton: string) =>
    demarrer(async () => {
      setErreur(null);
      setRemise(null);
      const reponse = await appelerAction(() => verifierCarte(jeton));
      if (!reponse.ok) {
        setResultat(null);
        setErreur(reponse.erreur);
        return;
      }
      setResultat(reponse.donnees);
    });

  const valide = resultat?.statut === "active";
  const attente = resultat?.statut === "en_attente";

  return (
    <div className="grid gap-5">
      <Scanner onScan={verifier} libelle="Scannez la carte ou saisissez son code" avecCamera />
      {erreur ? <MessageErreur>{erreur}</MessageErreur> : null}
      {resultat ? (
        <section
          aria-label="Résultat de la vérification"
          aria-busy={enCours}
          className={
            valide
              ? "grid gap-3 rounded-md bg-bleu-voile px-5 py-4 text-nuit"
              : attente
                ? "grid gap-3 rounded-md bg-soleil px-5 py-4 text-nuit"
                : "grid gap-3 rounded-md bg-rose-voile px-5 py-4 text-alerte"
          }
        >
          <p role="status" className="m-0 flex items-start gap-3 font-bold">
            {valide ? (
              <CircleCheck aria-hidden className="mt-0.5 size-6 shrink-0" />
            ) : (
              <TriangleAlert aria-hidden className="mt-0.5 size-6 shrink-0" />
            )}
            {remise ?? resultat.message}
          </p>
          {resultat.famille ? (
            <div className="grid gap-2 text-nuit">
              <Link href={`/familles/${resultat.famille.id}`} className="font-bold">
                Famille {resultat.famille.nom}
                {resultat.type === "enfant" ? " (carte enfant)" : ""}
              </Link>
              <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
                {resultat.famille.enfants.map((e, i) => (
                  <li key={i} className="flex items-center gap-2">
                    {e.matricule ? <MatriculeBadge matricule={e.matricule} /> : null}
                    {e.prenom}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {attente && peutRemettre && resultat.carteId && !remise ? (
            <Button
              type="button"
              variant="bleu"
              className="justify-self-start"
              disabled={enCours}
              onClick={() =>
                demarrer(async () => {
                  const reponse = await appelerAction(() => remettreCarte(resultat.carteId));
                  if (!reponse.ok) {
                    setErreur(reponse.erreur);
                    return;
                  }
                  setRemise("Carte remise : elle est active, l'ancienne carte est révoquée.");
                })
              }
            >
              Remettre la carte
            </Button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

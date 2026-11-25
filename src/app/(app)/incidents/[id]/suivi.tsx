"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { NotchCard } from "@/components/hk/notch-card";
import { Button } from "@/components/ui/button";
import { MessageErreur } from "@/components/ui/champ";
import { ModaleConfirmation } from "@/components/ui/modale-confirmation";
import { appelerAction } from "@/lib/appel-action";
import { MessageSucces } from "../../parametres/entete";
import { clore, noterIncident } from "./actions";

/**
 * Notes and closure of an incident: the declaration stays as it was written; what is learned
 * afterwards is added as a note; the closure is final.
 */
export function SuiviIncident({
  incidentId,
  clos,
  notes,
}: {
  incidentId: string;
  clos: { le: string; par: string } | null;
  notes: { id: string; texte: string; auteur: string; date: string }[];
}) {
  const router = useRouter();
  const [texte, setTexte] = useState("");
  const [confirmer, setConfirmer] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  return (
    <div className="grid gap-6">
      {message ? (
        message.ok ? (
          <MessageSucces>{message.texte}</MessageSucces>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}

      <section aria-labelledby="notes" className="grid gap-3">
        <h2 id="notes" className="m-0 font-display text-h2 font-semibold">
          Notes de suivi
        </h2>
        {notes.length === 0 ? (
          <p className="m-0 text-texte-doux">Aucune note pour l&apos;instant.</p>
        ) : (
          <ul aria-label="Notes" className="m-0 grid list-none gap-3 p-0">
            {notes.map((n) => (
              <li key={n.id} className="grid gap-1 rounded-md bg-blanc px-5 py-3 shadow-card">
                <span className="text-label text-texte-doux">
                  {n.date} · {n.auteur}
                </span>
                <span>{n.texte}</span>
              </li>
            ))}
          </ul>
        )}
        <NotchCard couleur="blanc" aria-label="Ajouter une note">
          <form
            className="grid gap-3"
            onSubmit={(evenement) => {
              evenement.preventDefault();
              demarrer(async () => {
                setMessage(null);
                const resultat = await appelerAction(() => noterIncident(incidentId, texte));
                if (!resultat.ok) {
                  setMessage({ ok: false, texte: resultat.erreur });
                  return;
                }
                setMessage({ ok: true, texte: "Note ajoutée." });
                setTexte("");
                router.refresh();
              });
            }}
          >
            <label className="grid gap-2 font-bold">
              Nouvelle note
              <textarea
                className="min-h-24 rounded-md border-2 border-nuit bg-blanc px-4 py-3 font-normal"
                value={texte}
                maxLength={1000}
                onChange={(e) => setTexte(e.target.value)}
              />
            </label>
            <Button type="submit" variant="bleu" disabled={enCours} className="justify-self-start">
              Ajouter la note
            </Button>
          </form>
        </NotchCard>
      </section>

      {clos ? (
        <p className="m-0 font-bold">
          Incident clos le {clos.le} par {clos.par}.
        </p>
      ) : (
        <div>
          <Button
            type="button"
            variant="sombre"
            disabled={enCours}
            onClick={() => setConfirmer(true)}
          >
            Clore l&apos;incident
          </Button>
        </div>
      )}

      <ModaleConfirmation
        ouverte={confirmer}
        titre="Clore cet incident ?"
        libelleConfirmer="Clore l'incident"
        enCours={enCours}
        onAnnuler={() => setConfirmer(false)}
        onConfirmer={() =>
          demarrer(async () => {
            const resultat = await appelerAction(() => clore(incidentId));
            setConfirmer(false);
            setMessage(
              resultat.ok
                ? { ok: true, texte: "Incident clos." }
                : { ok: false, texte: resultat.erreur },
            );
            router.refresh();
          })
        }
      >
        <p className="m-0">La clôture est définitive. Des notes pourront encore être ajoutées.</p>
      </ModaleConfirmation>
    </div>
  );
}

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, useTransition } from "react";
import { ChildCard } from "@/components/hk/child-card";
import { NotchCard } from "@/components/hk/notch-card";
import { Button } from "@/components/ui/button";
import { MessageErreur } from "@/components/ui/champ";
import { appelerAction } from "@/lib/appel-action";
import { LIBELLES_CANAL as CANAUX, RESULTATS_APPEL, type ResultatAppel } from "@/lib/appels";
import { useLiveQuery } from "@/lib/live-query";
import { formaterTelephone } from "@/lib/telephone";
import type { FicheDirect } from "../acces-presence";
import { MessageSucces } from "../../parametres/entete";
import { LiensUrgence } from "../urgence";
import { noterResultatUrgence } from "./actions";

/**
 * A child's presence card, live (lot 3): the child with their medical alerts, the Urgence
 * button (family contacts, each call logged) and the call journal, where a call's result is
 * noted once. The server decides what the member may see and do (droitsPresence).
 */
export function FicheEnfant({ presenceId }: { presenceId: string }) {
  const cle = ["presence", presenceId] as const;
  const direct = useLiveQuery<FicheDirect>(cle, `/api/direct/presences/${presenceId}`);
  const client = useQueryClient();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();
  const rafraichir = () => client.invalidateQueries({ queryKey: cle });

  if (direct.isPending) return <p className="m-0 text-texte-doux">Chargement de la fiche…</p>;
  if (direct.isError && !direct.data) {
    return (
      <MessageErreur>
        La fiche ne se charge pas. Vérifiez la connexion : elle se met à jour dès son retour.
      </MessageErreur>
    );
  }
  const { fiche, contacts, journal, droits } = direct.data!;
  const nomDuNumero = (numero: string) => {
    const contact = contacts.find((c) => c.telephones.includes(numero) || c.whatsapp === numero);
    return contact ? `${contact.prenom} ${contact.nom}` : formaterTelephone(numero);
  };

  const noter = (appelId: string, resultat: ResultatAppel) =>
    demarrer(async () => {
      setMessage(null);
      const reponse = await appelerAction(() =>
        noterResultatUrgence({ presenceId, appelId, resultat }),
      );
      setMessage(
        reponse.ok
          ? { ok: true, texte: `Résultat noté : ${RESULTATS_APPEL[resultat]}.` }
          : { ok: false, texte: reponse.erreur },
      );
      await rafraichir();
    });

  return (
    <section aria-label={`Fiche de ${fiche.prenom}`} className="grid gap-6">
      {direct.isError ? (
        <p role="alert" className="m-0 font-bold text-alerte">
          Hors connexion : cette fiche n&apos;est plus à jour.
        </p>
      ) : null}

      <ChildCard
        prenom={fiche.prenom}
        nom={fiche.nom}
        age={fiche.age}
        classe={fiche.classe}
        matricule={fiche.matricule}
        statut={fiche.statut}
        alertes={fiche.alertes}
        photoUrl={fiche.photoKey ? `/api/fichiers/${fiche.photoKey}` : null}
      />

      {message ? (
        message.ok ? (
          <MessageSucces>{message.texte}</MessageSucces>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}

      {droits.appeler ? (
        <NotchCard couleur="blanc" aria-label="Urgence">
          <div className="grid gap-4">
            <h2 id="urgence" className="m-0 font-display text-h2 font-semibold text-alerte">
              Urgence
            </h2>
            <p className="m-0 text-texte-doux">
              Touchez un numéro pour appeler : l&apos;appel est noté au journal.
            </p>
            <LiensUrgence presenceId={presenceId} contacts={contacts} onJournalise={rafraichir} />
          </div>
        </NotchCard>
      ) : null}

      <section aria-labelledby="journal-appels" className="grid gap-3">
        <h2 id="journal-appels" className="m-0 font-display text-h2 font-semibold">
          Journal des appels
        </h2>
        {journal.length === 0 ? (
          <p className="m-0 text-texte-doux">Aucun appel pour cet enfant dans cette session.</p>
        ) : (
          <ul aria-label="Appels passés" className="m-0 grid list-none gap-3 p-0">
            {journal.map((appel) => {
              const libelle = `${CANAUX[appel.canal]} à ${nomDuNumero(appel.numero)}, ${appel.heure}`;
              return (
                <li
                  key={appel.id}
                  aria-label={libelle}
                  aria-describedby={`resultat-${appel.id}`}
                  className="grid gap-2 rounded-md bg-blanc px-4 py-3 shadow-card"
                >
                  <p className="m-0">
                    <span className="font-bold">{appel.heure}</span> · {CANAUX[appel.canal]} à{" "}
                    {nomDuNumero(appel.numero)} ({formaterTelephone(appel.numero)}) · par{" "}
                    {appel.auteur}
                  </p>
                  <p id={`resultat-${appel.id}`} className="m-0 text-texte-doux">
                    {appel.resultat
                      ? `Résultat : ${RESULTATS_APPEL[appel.resultat]}`
                      : "Résultat à noter"}
                  </p>
                  {!appel.resultat && droits.appeler ? (
                    <div className="flex flex-wrap gap-3">
                      {(Object.keys(RESULTATS_APPEL) as ResultatAppel[]).map((resultat) => (
                        <Button
                          key={resultat}
                          type="button"
                          variant="ghost"
                          disabled={enCours}
                          onClick={() => noter(appel.id, resultat)}
                        >
                          {RESULTATS_APPEL[resultat]}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}

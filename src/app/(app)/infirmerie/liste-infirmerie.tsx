"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { InfirmerieDirect } from "@/app/api/direct/infirmerie/route";
import { BandeauInfirmerie } from "@/components/hk/bandeau-infirmerie";
import { ChildCard } from "@/components/hk/child-card";
import { Button } from "@/components/ui/button";
import { MessageErreur } from "@/components/ui/champ";
import { appelerAction } from "@/lib/appel-action";
import { INTERVALLE_URGENT_MS, useLiveQuery } from "@/lib/live-query";
import { MessageSucces } from "../parametres/entete";
import { recevoirAInfirmerie, renvoyerEnClasseDepuisInfirmerie } from "../presences/[id]/actions";

type Enfant = InfirmerieDirect["enfants"][number];

/**
 * Children at the infirmerie, live. A child sent and not received after the church's delay
 * is announced in red at the top ("… n'est pas arrivé à l'infirmerie") until received or
 * sent back. The server checks the rights again on every action.
 */
export function ListeInfirmerie() {
  const cle = ["infirmerie"] as const;
  const direct = useLiveQuery<InfirmerieDirect>(cle, "/api/direct/infirmerie", {
    intervalleMs: INTERVALLE_URGENT_MS,
  });
  const client = useQueryClient();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  const agir = (
    fn: () => Promise<{ ok: true; donnees: unknown } | { ok: false; erreur: string }>,
    succes: string,
  ) =>
    demarrer(async () => {
      setMessage(null);
      const reponse = await appelerAction(fn);
      setMessage(reponse.ok ? { ok: true, texte: succes } : { ok: false, texte: reponse.erreur });
      await client.invalidateQueries({ queryKey: cle });
    });

  if (direct.isPending)
    return <p className="m-0 text-texte-doux">Chargement de l&apos;infirmerie…</p>;
  if (direct.isError && !direct.data) {
    return (
      <MessageErreur>
        La liste ne se charge pas. Vérifiez la connexion : la page se met à jour dès son retour.
      </MessageErreur>
    );
  }
  const { enfants } = direct.data!;
  const nonArrives = enfants.filter((e) => e.nonArrive);
  const enRoute = enfants.filter((e) => e.enRoute);
  const recus = enfants.filter((e) => !e.enRoute);

  const ligne = (e: Enfant, index: number) => (
    <li
      key={e.presenceId}
      aria-label={e.prenom}
      aria-describedby={`infirmerie-${e.presenceId}`}
      className="grid items-center gap-3 md:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="grid gap-2">
        <ChildCard
          prenom={e.prenom}
          nom={e.nom}
          age={e.age}
          classe={e.classe}
          matricule={e.matricule}
          statut="INFIRMERIE"
          alertes={e.alertes}
          photoUrl={e.photoKey ? `/api/fichiers/${e.photoKey}` : null}
          index={index}
        />
        <p id={`infirmerie-${e.presenceId}`} className="m-0 text-texte-doux">
          {e.enRoute
            ? `En route depuis ${e.depuisMinutes} min`
            : `À l'infirmerie, parti de la classe il y a ${e.depuisMinutes} min`}
          {e.accompagnant ? ` · accompagné par ${e.accompagnant}` : ""}
          {e.motif ? ` · ${e.motif}` : ""}
        </p>
        <Link href={`/presences/${e.presenceId}`} className="justify-self-start font-bold">
          Fiche de {e.prenom}
        </Link>
      </div>
      <div className="flex flex-wrap gap-3">
        {e.enRoute ? (
          <Button
            type="button"
            variant="bleu"
            size="xl"
            disabled={enCours}
            onClick={() =>
              agir(
                () => recevoirAInfirmerie({ presenceId: e.presenceId }),
                `${e.prenom} est reçu à l'infirmerie.`,
              )
            }
          >
            Recevoir {e.prenom}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="xl"
          disabled={enCours}
          aria-label={`Renvoyer ${e.prenom} en classe`}
          onClick={() =>
            agir(
              () => renvoyerEnClasseDepuisInfirmerie({ presenceId: e.presenceId }),
              `${e.prenom} est renvoyé en classe : la classe confirmera son arrivée.`,
            )
          }
        >
          Renvoyer en classe
        </Button>
      </div>
    </li>
  );

  return (
    <section aria-label="Enfants à l'infirmerie" className="grid gap-6">
      {direct.isError ? (
        <p role="alert" className="m-0 font-bold text-alerte">
          Hors connexion : cette liste n&apos;est plus à jour.
        </p>
      ) : null}
      {nonArrives.map((e) => (
        <BandeauInfirmerie key={e.presenceId}>
          {e.prenom} n&apos;est pas arrivé à l&apos;infirmerie (parti de {e.classe} il y a{" "}
          {e.depuisMinutes} min).
        </BandeauInfirmerie>
      ))}
      {message ? (
        message.ok ? (
          <MessageSucces>{message.texte}</MessageSucces>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}

      <section aria-labelledby="en-route" className="grid gap-3">
        <h2 id="en-route" className="m-0 font-display text-h2 font-semibold">
          En route ({enRoute.length})
        </h2>
        {enRoute.length === 0 ? (
          <p className="m-0 text-texte-doux">Aucun enfant en route vers l&apos;infirmerie.</p>
        ) : (
          <ul aria-label="Enfants en route" className="m-0 grid list-none gap-3 p-0">
            {enRoute.map(ligne)}
          </ul>
        )}
      </section>

      <section aria-labelledby="recus" className="grid gap-3">
        <h2 id="recus" className="m-0 font-display text-h2 font-semibold">
          À l&apos;infirmerie ({recus.length})
        </h2>
        {recus.length === 0 ? (
          <p className="m-0 text-texte-doux">Aucun enfant à l&apos;infirmerie.</p>
        ) : (
          <ul aria-label="Enfants reçus" className="m-0 grid list-none gap-3 p-0">
            {recus.map(ligne)}
          </ul>
        )}
      </section>
    </section>
  );
}

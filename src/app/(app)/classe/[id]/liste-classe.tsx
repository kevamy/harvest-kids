"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { ListeClasseDirect } from "@/app/api/direct/classes/[id]/route";
import { ChildCard } from "@/components/hk/child-card";
import { NotchCard } from "@/components/hk/notch-card";
import { Scanner } from "@/components/hk/scanner";
import { Button } from "@/components/ui/button";
import { MessageErreur } from "@/components/ui/champ";
import { appelerAction } from "@/lib/appel-action";
import { useLiveQuery } from "@/lib/live-query";
import type { EnfantSalle, ResultatConfirmation } from "@/server/salle";
import { MessageSucces } from "../../parametres/entete";
import { annulerArrivee, confirmerArrivee, confirmerArriveeParScan } from "./actions";

/** "Ayo", "Ayo et Sèna", "Ayo, Sèna et Koffi". */
function enumerer(prenoms: string[]): string {
  return prenoms.length <= 1
    ? (prenoms[0] ?? "")
    : `${prenoms.slice(0, -1).join(", ")} et ${prenoms.at(-1)}`;
}

/** The confirmation repeats the verb of the action (design/charte.md). */
function messageConfirmation({ confirmes, dejaEnSalle }: ResultatConfirmation): string {
  const parties: string[] = [];
  if (confirmes.length === 1) parties.push(`Arrivée de ${confirmes[0]} confirmée.`);
  if (confirmes.length > 1) parties.push(`Arrivées de ${enumerer(confirmes)} confirmées.`);
  if (dejaEnSalle.length === 1) parties.push(`${dejaEnSalle[0]} est déjà en salle.`);
  if (dejaEnSalle.length > 1) parties.push(`${enumerer(dejaEnSalle)} sont déjà en salle.`);
  return parties.join(" ");
}

/**
 * Class list in a session (cahier §7.4), live: children to confirm at the top, children in
 * class below, medical alerts always shown. The assigned members confirm an arrival by a
 * touch on "Confirmer l'arrivée" or by scanning the child's or the family's card. For one
 * minute, the member who confirmed sees "Annuler" (back to "to confirm"); afterwards, a
 * RESPONSABLE corrects with a reason. The server checks the rights and the delay.
 */
export function ListeClasse({
  sessionClasseId,
  nomClasse,
}: {
  sessionClasseId: string;
  nomClasse: string;
}) {
  const cle = ["classe", sessionClasseId] as const;
  const liste = useLiveQuery<ListeClasseDirect>(cle, `/api/direct/classes/${sessionClasseId}`);
  const client = useQueryClient();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [correction, setCorrection] = useState<{ presenceId: string; motif: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  const agir = <T,>(
    fn: () => Promise<{ ok: true; donnees: T } | { ok: false; erreur: string }>,
    succes: (donnees: T) => string,
  ) =>
    demarrer(async () => {
      setMessage(null);
      const resultat = await appelerAction(fn);
      if (!resultat.ok) {
        setMessage({ ok: false, texte: resultat.erreur });
        return;
      }
      setMessage({ ok: true, texte: succes(resultat.donnees) });
      setCorrection(null);
      await client.invalidateQueries({ queryKey: cle });
    });

  if (liste.isPending) return <p className="m-0 text-texte-doux">Chargement de la classe…</p>;
  if (liste.isError && !liste.data) {
    return (
      <MessageErreur>
        La liste ne se charge pas. Vérifiez la connexion : la page se met à jour dès son retour.
      </MessageErreur>
    );
  }
  const { enfants, droits, sessionOuverte } = liste.data!;
  const infirmerie = enfants.filter((e) => e.statut === "INFIRMERIE");
  const aConfirmer = enfants.filter((e) => e.statut === "PRESENT");
  const enSalle = enfants.filter((e) => e.statut === "EN_SALLE");

  const carte = (e: EnfantSalle, index: number) => (
    <div className="grid gap-2">
      <ChildCard
        prenom={e.prenom}
        nom={e.nom}
        age={e.age}
        classe={nomClasse}
        matricule={e.matricule}
        statut={e.statut}
        alertes={e.alertes}
        photoUrl={e.photoKey ? `/api/fichiers/${e.photoKey}` : null}
        index={index}
      />
      {/* Urgence, infirmerie, parent call: from the child's card (lot 3). */}
      <Link href={`/presences/${e.presenceId}`} className="justify-self-start font-bold">
        Fiche de {e.prenom}
      </Link>
    </div>
  );

  return (
    <section aria-label={`Liste de ${nomClasse}`} className="grid gap-6">
      {liste.isError ? (
        <p role="alert" className="m-0 font-bold text-alerte">
          Hors connexion : cette liste n&apos;est plus à jour.
        </p>
      ) : null}
      {!sessionOuverte ? (
        <p className="m-0 font-bold text-texte-doux">La session est clôturée.</p>
      ) : null}

      {droits.confirmer && sessionOuverte ? (
        <NotchCard couleur="blanc" aria-label="Confirmer par scan">
          <div className="grid gap-4">
            <h2 className="m-0 font-display text-h3 font-semibold">Confirmer par scan</h2>
            <Scanner
              avecCamera
              libelle="Scannez la carte de l'enfant ou de la famille"
              onScan={(jeton) =>
                agir(() => confirmerArriveeParScan({ sessionClasseId, jeton }), messageConfirmation)
              }
            />
          </div>
        </NotchCard>
      ) : null}

      {message ? (
        message.ok ? (
          <MessageSucces>{message.texte}</MessageSucces>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}

      {infirmerie.length > 0 ? (
        <section aria-labelledby="infirmerie" className="grid gap-3">
          <h2 id="infirmerie" className="m-0 font-display text-h2 font-semibold text-alerte">
            À l&apos;infirmerie ({infirmerie.length})
          </h2>
          <ul aria-label="Enfants à l'infirmerie" className="m-0 grid list-none gap-3 p-0">
            {infirmerie.map((e, i) => (
              <li key={e.presenceId}>{carte(e, i)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="a-confirmer" className="grid gap-3">
        <h2 id="a-confirmer" className="m-0 font-display text-h2 font-semibold">
          À confirmer ({aConfirmer.length})
        </h2>
        {aConfirmer.length === 0 ? (
          <p className="m-0 text-texte-doux">Aucun enfant en route vers la classe.</p>
        ) : (
          <ul aria-label="Enfants à confirmer" className="m-0 grid list-none gap-3 p-0">
            {aConfirmer.map((e, i) => (
              <li
                key={e.presenceId}
                aria-label={e.prenom}
                aria-describedby={`attente-${e.presenceId}`}
                className="grid items-center gap-3 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="grid gap-2">
                  {carte(e, i)}
                  <p
                    id={`attente-${e.presenceId}`}
                    className={
                      e.enRetard ? "m-0 font-bold text-alerte" : "m-0 text-label text-texte-doux"
                    }
                  >
                    {e.enRetard
                      ? `Toujours pas en salle : check-in à l'accueil il y a ${e.attenteMinutes} min`
                      : `Check-in à l'accueil il y a ${e.attenteMinutes} min`}
                  </p>
                </div>
                {droits.confirmer && sessionOuverte ? (
                  <Button
                    type="button"
                    variant="bleu"
                    size="xl"
                    disabled={enCours}
                    aria-label={`Confirmer l'arrivée de ${e.prenom}`}
                    onClick={() =>
                      agir(
                        () => confirmerArrivee({ sessionClasseId, presenceId: e.presenceId }),
                        messageConfirmation,
                      )
                    }
                  >
                    <CircleCheck aria-hidden />
                    Confirmer l&apos;arrivée
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="en-salle" className="grid gap-3">
        <h2 id="en-salle" className="m-0 font-display text-h2 font-semibold">
          En salle ({enSalle.length})
        </h2>
        {enSalle.length === 0 ? (
          <p className="m-0 text-texte-doux">Aucun enfant en salle pour l&apos;instant.</p>
        ) : (
          <ul aria-label="Enfants en salle" className="m-0 grid list-none gap-3 p-0">
            {enSalle.map((e, i) => (
              <li
                key={e.presenceId}
                aria-label={e.prenom}
                className="grid items-center gap-3 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                {carte(e, i)}
                {sessionOuverte && e.annulable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xl"
                    disabled={enCours}
                    aria-label={`Annuler l'arrivée de ${e.prenom}`}
                    onClick={() =>
                      agir(
                        () => annulerArrivee({ sessionClasseId, presenceId: e.presenceId }),
                        ({ prenom }) => `Arrivée de ${prenom} annulée : à confirmer de nouveau.`,
                      )
                    }
                  >
                    <Undo2 aria-hidden />
                    Annuler
                  </Button>
                ) : sessionOuverte && droits.corriger ? (
                  correction?.presenceId === e.presenceId ? (
                    <form
                      className="grid gap-2 md:w-80"
                      aria-label={`Correction de l'arrivée de ${e.prenom}`}
                      onSubmit={(ev) => {
                        ev.preventDefault();
                        agir(
                          () =>
                            annulerArrivee({
                              sessionClasseId,
                              presenceId: e.presenceId,
                              motif: correction.motif,
                            }),
                          ({ prenom }) => `Arrivée de ${prenom} corrigée : à confirmer de nouveau.`,
                        );
                      }}
                    >
                      <label htmlFor={`motif-${e.presenceId}`} className="text-label font-bold">
                        Motif de la correction
                      </label>
                      <textarea
                        id={`motif-${e.presenceId}`}
                        required
                        minLength={3}
                        maxLength={300}
                        rows={2}
                        value={correction.motif}
                        onChange={(ev) => setCorrection({ ...correction, motif: ev.target.value })}
                        className="rounded-md bg-blanc px-4 py-3 text-body shadow-[inset_0_0_0_2px_var(--color-ligne)]"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" variant="sombre" disabled={enCours}>
                          Remettre à confirmer
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setCorrection(null)}>
                          Fermer
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xl"
                      aria-label={`Corriger l'arrivée de ${e.prenom}`}
                      onClick={() => {
                        setMessage(null);
                        setCorrection({ presenceId: e.presenceId, motif: "" });
                      }}
                    >
                      Corriger
                    </Button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

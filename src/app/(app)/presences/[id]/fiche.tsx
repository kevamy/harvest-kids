"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, useTransition } from "react";
import { BandeauInfirmerie, phraseInfirmerie } from "@/components/hk/bandeau-infirmerie";
import { ChildCard } from "@/components/hk/child-card";
import { NotchCard } from "@/components/hk/notch-card";
import { Button } from "@/components/ui/button";
import { MessageErreur } from "@/components/ui/champ";
import { appelerAction } from "@/lib/appel-action";
import {
  LIBELLES_CANAL as CANAUX,
  MOTIFS_APPEL,
  RESULTATS_APPEL,
  type MotifAppel,
  type ResultatAppel,
} from "@/lib/appels";
import { useLiveQuery } from "@/lib/live-query";
import { formaterTelephone } from "@/lib/telephone";
import type { FicheDirect } from "../acces-presence";
import { MessageSucces } from "../../parametres/entete";
import { LiensUrgence } from "../urgence";
import { LIBELLES_INCIDENT, TYPES_DECLARABLES, type TypeDeclarable } from "@/lib/incidents";
import {
  appelerLeParent,
  declarerIncidentEnfant,
  envoyerAInfirmerie,
  noterResultatUrgence,
  recevoirAInfirmerie,
  renvoyerEnClasseDepuisInfirmerie,
  terminerAppel,
} from "./actions";

/** "Déclarer un incident" (cahier §7.9): type, what happened, who was there, what was done. */
function DeclarationIncident({
  prenom,
  enCours,
  onDeclarer,
}: {
  prenom: string;
  enCours: boolean;
  onDeclarer: (
    saisie: { type: TypeDeclarable; description: string; personnes: string; mesures: string },
    vider: () => void,
  ) => void;
}) {
  const vide = { type: "BLESSURE" as TypeDeclarable, description: "", personnes: "", mesures: "" };
  const [saisie, setSaisie] = useState(vide);
  const champ = "rounded-md border-2 border-nuit bg-blanc px-4 py-3 font-normal";
  return (
    <NotchCard couleur="blanc" aria-label="Déclarer un incident">
      <form
        className="grid gap-4"
        onSubmit={(evenement) => {
          evenement.preventDefault();
          onDeclarer(saisie, () => setSaisie(vide));
        }}
      >
        <h2 className="m-0 font-display text-h2 font-semibold">Déclarer un incident</h2>
        <label className="grid max-w-md gap-2 font-bold">
          Type d&apos;incident
          <select
            className={`min-h-touch ${champ}`}
            value={saisie.type}
            onChange={(e) => setSaisie({ ...saisie, type: e.target.value as TypeDeclarable })}
          >
            {TYPES_DECLARABLES.map((t) => (
              <option key={t} value={t}>
                {LIBELLES_INCIDENT[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 font-bold">
          Ce qui s&apos;est passé
          <textarea
            className={`min-h-24 ${champ}`}
            value={saisie.description}
            maxLength={2000}
            onChange={(e) => setSaisie({ ...saisie, description: e.target.value })}
          />
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 font-bold">
            Personnes présentes
            <input
              className={`min-h-touch ${champ}`}
              value={saisie.personnes}
              maxLength={500}
              onChange={(e) => setSaisie({ ...saisie, personnes: e.target.value })}
            />
          </label>
          <label className="grid gap-2 font-bold">
            Mesures prises
            <input
              className={`min-h-touch ${champ}`}
              value={saisie.mesures}
              maxLength={1000}
              onChange={(e) => setSaisie({ ...saisie, mesures: e.target.value })}
            />
          </label>
        </div>
        <Button type="submit" variant="sombre" disabled={enCours} className="justify-self-start">
          Déclarer l&apos;incident de {prenom}
        </Button>
      </form>
    </NotchCard>
  );
}

/** "Appeler le parent": a reason and a meeting place, shown on the call screen (RG-10). */
function AppelParent({
  prenom,
  lieux,
  lieuParDefaut,
  enCours,
  onAppeler,
}: {
  prenom: string;
  lieux: string[];
  lieuParDefaut: string;
  enCours: boolean;
  onAppeler: (motif: MotifAppel, lieu: string) => void;
}) {
  const [motif, setMotif] = useState<MotifAppel>("pleurs");
  const [lieu, setLieu] = useState(lieuParDefaut);
  const champ = "min-h-touch rounded-md border-2 border-nuit bg-blanc px-4 font-normal";
  return (
    <NotchCard couleur="blanc" aria-label="Appeler le parent">
      <form
        className="grid gap-4"
        onSubmit={(evenement) => {
          evenement.preventDefault();
          onAppeler(motif, lieu);
        }}
      >
        <h2 className="m-0 font-display text-h2 font-semibold">Appeler le parent</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 font-bold">
            Motif de l&apos;appel
            <select
              className={champ}
              value={motif}
              onChange={(e) => setMotif(e.target.value as MotifAppel)}
            >
              {(Object.keys(MOTIFS_APPEL) as MotifAppel[]).map((m) => (
                <option key={m} value={m}>
                  {MOTIFS_APPEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 font-bold">
            Lieu de rendez-vous
            <select className={champ} value={lieu} onChange={(e) => setLieu(e.target.value)}>
              {lieux.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Button
          type="submit"
          variant="soleil"
          size="xl"
          disabled={enCours}
          className="justify-self-start"
        >
          Appeler le parent de {prenom}
        </Button>
      </form>
    </NotchCard>
  );
}

/** "Accompagner à l'infirmerie": who accompanies (the reader by default) and why. */
function EnvoiInfirmerie({
  prenom,
  accompagnants,
  enCours,
  onEnvoyer,
}: {
  prenom: string;
  accompagnants: { userId: string; nom: string }[];
  enCours: boolean;
  onEnvoyer: (accompagnantUserId: string, motif: string) => void;
}) {
  const [accompagnant, setAccompagnant] = useState(accompagnants[0]!.userId);
  const [motif, setMotif] = useState("");
  return (
    <NotchCard couleur="blanc" aria-label="Accompagner à l'infirmerie">
      <form
        className="grid gap-4"
        onSubmit={(evenement) => {
          evenement.preventDefault();
          onEnvoyer(accompagnant, motif);
        }}
      >
        <h2 className="m-0 font-display text-h2 font-semibold">Accompagner à l&apos;infirmerie</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 font-bold">
            Accompagné par
            <select
              className="min-h-touch rounded-md border-2 border-nuit bg-blanc px-4 font-normal"
              value={accompagnant}
              onChange={(e) => setAccompagnant(e.target.value)}
            >
              {accompagnants.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.nom}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 font-bold">
            Motif
            <input
              className="min-h-touch rounded-md border-2 border-nuit bg-blanc px-4 font-normal"
              value={motif}
              maxLength={200}
              placeholder="Fièvre, chute, mal au ventre…"
              onChange={(e) => setMotif(e.target.value)}
            />
          </label>
        </div>
        <Button
          type="submit"
          variant="alerte"
          size="xl"
          disabled={enCours}
          className="justify-self-start"
        >
          Accompagner {prenom} à l&apos;infirmerie
        </Button>
      </form>
    </NotchCard>
  );
}

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
  const { fiche, contacts, journal, droits, accompagnants, appel, lieux } = direct.data!;
  const nomDuNumero = (numero: string) => {
    const contact = contacts.find((c) => c.telephones.includes(numero) || c.whatsapp === numero);
    return contact ? `${contact.prenom} ${contact.nom}` : formaterTelephone(numero);
  };

  const agir = (
    fn: () => Promise<{ ok: true; donnees: unknown } | { ok: false; erreur: string }>,
    succes: string,
  ) =>
    demarrer(async () => {
      setMessage(null);
      const reponse = await appelerAction(fn);
      setMessage(reponse.ok ? { ok: true, texte: succes } : { ok: false, texte: reponse.erreur });
      await rafraichir();
    });

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

      {fiche.statut === "INFIRMERIE" && fiche.infirmerieDepuisMinutes !== null ? (
        <BandeauInfirmerie>
          {phraseInfirmerie(fiche.prenom, fiche.infirmerieDepuisMinutes, fiche.enRoute)}
        </BandeauInfirmerie>
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

      {fiche.statut === "INFIRMERIE" && droits.gerer && fiche.sessionOuverte ? (
        <div className="flex flex-wrap gap-3">
          {fiche.enRoute ? (
            <Button
              type="button"
              variant="bleu"
              size="xl"
              disabled={enCours}
              onClick={() =>
                agir(
                  () => recevoirAInfirmerie({ presenceId }),
                  `${fiche.prenom} est reçu à l'infirmerie.`,
                )
              }
            >
              Recevoir {fiche.prenom}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="xl"
            disabled={enCours}
            onClick={() =>
              agir(
                () => renvoyerEnClasseDepuisInfirmerie({ presenceId }),
                `${fiche.prenom} est renvoyé en classe : la classe confirmera son arrivée.`,
              )
            }
          >
            Renvoyer en classe
          </Button>
        </div>
      ) : null}

      {accompagnants.length > 0 ? (
        <EnvoiInfirmerie
          prenom={fiche.prenom}
          accompagnants={accompagnants}
          enCours={enCours}
          onEnvoyer={(accompagnantUserId, motif) =>
            agir(
              () => envoyerAInfirmerie({ presenceId, accompagnantUserId, motif }),
              `${fiche.prenom} part à l'infirmerie.`,
            )
          }
        />
      ) : null}

      {appel ? (
        <NotchCard couleur="blanc" aria-label="Appel du parent">
          <div className="grid gap-4">
            <h2 className="m-0 font-display text-h2 font-semibold">Parent appelé</h2>
            <p className="m-0 rounded-md bg-soleil px-4 py-3 font-bold text-nuit">
              {MOTIFS_APPEL[appel.motif]} · rendez-vous : {appel.lieu} · depuis{" "}
              {appel.depuisMinutes} min
            </p>
            {droits.appeler ? (
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="bleu"
                  disabled={enCours}
                  onClick={() =>
                    agir(
                      () => terminerAppel({ presenceId, resolution: "parent_arrive" }),
                      "Parent arrivé : l'appel est retiré de l'écran.",
                    )
                  }
                >
                  Parent arrivé
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={enCours}
                  onClick={() =>
                    agir(
                      () => terminerAppel({ presenceId, resolution: "annule" }),
                      "Appel annulé : il est retiré de l'écran.",
                    )
                  }
                >
                  Annuler l&apos;appel
                </Button>
              </div>
            ) : null}
          </div>
        </NotchCard>
      ) : lieux.length > 0 ? (
        <AppelParent
          prenom={fiche.prenom}
          lieux={lieux}
          // At the infirmerie, the infirmerie is the obvious meeting place.
          lieuParDefaut={
            (fiche.statut === "INFIRMERIE" &&
              lieux.find((l) => l.toLocaleLowerCase("fr").includes("infirmerie"))) ||
            lieux[0]!
          }
          enCours={enCours}
          onAppeler={(motif, lieu) =>
            agir(
              () => appelerLeParent({ presenceId, motif, lieu }),
              `Parent de ${fiche.prenom} appelé à l'écran : ${lieu}.`,
            )
          }
        />
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

      {droits.declarer ? (
        <DeclarationIncident
          prenom={fiche.prenom}
          enCours={enCours}
          onDeclarer={(saisie, vider) =>
            demarrer(async () => {
              setMessage(null);
              const reponse = await appelerAction(() =>
                declarerIncidentEnfant({ presenceId, ...saisie }),
              );
              if (!reponse.ok) {
                setMessage({ ok: false, texte: reponse.erreur });
                return;
              }
              setMessage({ ok: true, texte: "Incident déclaré : le responsable le voit." });
              vider();
            })
          }
        />
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

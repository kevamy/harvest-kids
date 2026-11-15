"use client";

import { CircleCheck, MessageCircle, Phone, TriangleAlert, UserRound, UserX } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { MatriculeBadge } from "@/components/hk/matricule-badge";
import { NotchCard } from "@/components/hk/notch-card";
import { Scanner } from "@/components/hk/scanner";
import { StatusPill } from "@/components/hk/status-pill";
import { Button } from "@/components/ui/button";
import { appelerAction } from "@/lib/appel-action";
import { formaterTelephone, lienTelephone, lienWhatsApp } from "@/lib/telephone";
import type { PreparationCheckout, ResultatCheckout } from "@/server/checkout";
import { preparerLeCheckout, validerLeCheckout } from "./actions";
import type { SessionOuverte } from "./checkin";

/** A retrieval code (4 characters, no ambiguous ones, RG-04); anything else is a card token. */
const CODE = /^[2-9A-HJKMNP-Z]{4}$/;

/** "Ayo", "Ayo et Sèna", "Ayo, Sèna et Koffi". */
function enumerer(prenoms: string[]): string {
  return prenoms.length <= 1
    ? (prenoms[0] ?? "")
    : `${prenoms.slice(0, -1).join(", ")} et ${prenoms.at(-1)}`;
}

/**
 * Check-out at the reception desk (cahier §7.6, RG-06): scan the parent's card or type the
 * session's retrieval code in the same field. The family's children present in the session
 * show their status and place, with the infirmary on top (RG-07); the agent checks the adult
 * against the photos of the authorised persons, touches the right photo, ticks the children
 * handed over and confirms the retrieval. A right card or code never suffices alone. An adult
 * who is not among the photos blocks the retrieval: the screen offers to call the main contact.
 */
export function Checkout({
  sessions,
  actif = true,
}: {
  sessions: SessionOuverte[];
  /** The tab is shown: its scan field takes the focus back. */
  actif?: boolean;
}) {
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? "");
  const [moyen, setMoyen] = useState<{ jeton: string } | { code: string } | null>(null);
  const [preparation, setPreparation] = useState<PreparationCheckout | null>(null);
  const [coches, setCoches] = useState<Record<string, boolean>>({});
  const [personneId, setPersonneId] = useState<string | null>(null);
  const [nonReconnue, setNonReconnue] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const [resultat, setResultat] = useState<ResultatCheckout | null>(null);
  const [enCours, demarrer] = useTransition();
  const champScan = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (actif) champScan.current?.focus();
  }, [resultat, actif]);

  const recommencer = () => {
    setMoyen(null);
    setPreparation(null);
    setCoches({});
    setPersonneId(null);
    setNonReconnue(false);
    setRefus(null);
    setResultat(null);
  };

  const familleSuivante = () => {
    recommencer();
    champScan.current?.focus();
  };

  const preparer = (valeur: string) => {
    const saisie = valeur.trim();
    const source = CODE.test(saisie.toUpperCase())
      ? { code: saisie.toUpperCase() }
      : { jeton: saisie };
    demarrer(async () => {
      recommencer();
      const reponse = await appelerAction(() => preparerLeCheckout({ sessionId, ...source }));
      if (!reponse.ok) {
        setRefus(reponse.erreur);
        return;
      }
      if ("refus" in reponse.donnees) {
        setRefus(reponse.donnees.refus);
        return;
      }
      const lue = reponse.donnees.preparation;
      setMoyen(source);
      setPreparation(lue);
      setCoches(Object.fromEntries(lue.enfants.map((e) => [e.presenceId, e.coche])));
    });
  };

  const valider = () => {
    if (!preparation || !moyen) return;
    const presenceIds = preparation.enfants
      .filter((e) => coches[e.presenceId])
      .map((e) => e.presenceId);
    demarrer(async () => {
      setRefus(null);
      const reponse = await appelerAction(() =>
        validerLeCheckout({
          sessionId,
          familleId: preparation.famille.id,
          ...moyen,
          personneAutoriseeId: personneId ?? "",
          presenceIds,
        }),
      );
      if (!reponse.ok) {
        setRefus(reponse.erreur);
        return;
      }
      setPreparation(null);
      setResultat(reponse.donnees);
    });
  };

  if (sessions.length === 0) {
    return (
      <NotchCard couleur="blanc">
        <p className="m-0">
          Aucune session ouverte : il n&apos;y a aucun enfant à remettre. Rechargez la page après
          l&apos;ouverture de la session.
        </p>
      </NotchCard>
    );
  }

  const infirmerie = preparation?.enfants.filter((e) => e.statut === "INFIRMERIE") ?? [];
  const contact = preparation?.contact ?? null;
  const telephone = contact?.telephone ?? null;
  const whatsapp = contact?.whatsapp ?? telephone;

  return (
    // Landscape: the scan takes a third of the width, the family two thirds.
    <div className="grid items-start gap-4 md:landscape:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <NotchCard couleur="blanc">
        <div className="grid gap-4">
          {/* The session is the card's header: it alone leaves room for the notch. */}
          {sessions.length > 1 ? (
            <header className="grid gap-2">
              <label htmlFor="session-checkout" className="text-label font-bold">
                Session
              </label>
              <select
                id="session-checkout"
                value={sessionId}
                onChange={(e) => {
                  setSessionId(e.target.value);
                  recommencer();
                }}
                className="min-h-touch rounded-md bg-blanc px-5 text-body-lg shadow-[inset_0_0_0_2px_var(--color-ligne)]"
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.libelle}
                  </option>
                ))}
              </select>
            </header>
          ) : (
            <header>
              <p className="m-0 font-bold">{sessions[0]!.libelle}</p>
            </header>
          )}
          <Scanner
            avecCamera
            champRef={champScan}
            libelle="Scannez la carte ou saisissez le code de retrait"
            onScan={preparer}
            onValiderVide={() => {
              if (resultat) familleSuivante();
            }}
          />
        </div>
      </NotchCard>

      <div className="grid gap-4">
        {refus ? (
          <p role="alert" className="m-0 rounded-md bg-rose-voile px-5 py-4 font-bold text-alerte">
            {refus}
          </p>
        ) : null}

        {resultat ? (
          <NotchCard couleur="blanc" aria-label="Retrait confirmé">
            <div className="grid gap-4">
              <header>
                <p role="status" className="m-0 flex items-center gap-3 font-bold text-succes">
                  <CircleCheck aria-hidden className="size-7" />
                  Retrait confirmé : {enumerer(resultat.enfants)} remis à {resultat.personne.prenom}{" "}
                  {resultat.personne.nom}.
                </p>
              </header>
              <div className="flex flex-wrap items-center gap-4">
                <Button type="button" variant="bleu" size="xl" onClick={familleSuivante}>
                  Famille suivante
                </Button>
                <span className="text-label text-texte-doux">
                  ou touche Entrée, ou scannez la carte suivante
                </span>
              </div>
            </div>
          </NotchCard>
        ) : preparation ? (
          <NotchCard
            couleur="blanc"
            aria-label={`Retrait de la famille ${preparation.famille.nom}`}
          >
            <div className="grid gap-4" aria-busy={enCours}>
              <h2 className="m-0 font-display text-h2 font-semibold">
                Famille {preparation.famille.nom}
              </h2>
              {/* RG-07: a child at the infirmary is announced first. */}
              {infirmerie.map((e) => (
                <p
                  key={e.presenceId}
                  role="alert"
                  className="m-0 flex gap-2 rounded-md bg-alerte px-4 py-3 font-bold text-blanc"
                >
                  <TriangleAlert aria-hidden className="size-6 shrink-0" />
                  {e.prenom} est à l&apos;infirmerie. Accompagnez le parent.
                </p>
              ))}
              {preparation.moyen.type === "carte" && preparation.moyen.enAttente ? (
                <p className="m-0 rounded-md bg-soleil px-4 py-2 text-label text-nuit">
                  Nouvelle carte : elle sera activée par ce retrait, et les anciennes cartes
                  remplacées.
                </p>
              ) : null}

              <ul className="m-0 grid list-none gap-3 p-0" aria-label="Enfants à remettre">
                {preparation.enfants.map((e) => (
                  <li
                    key={e.presenceId}
                    aria-label={e.prenom}
                    aria-describedby={`lieu-${e.presenceId}`}
                    className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1"
                  >
                    <label className="flex min-h-touch items-center gap-3">
                      <input
                        type="checkbox"
                        className="size-6 accent-rose-fonce"
                        checked={coches[e.presenceId] ?? false}
                        onChange={(ev) =>
                          setCoches({ ...coches, [e.presenceId]: ev.target.checked })
                        }
                      />
                      <span className="text-h3 font-bold">{e.prenom}</span>
                    </label>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <MatriculeBadge matricule={e.matricule} taille="md" />
                      <StatusPill statut={e.statut} />
                    </div>
                    <p id={`lieu-${e.presenceId}`} className="col-span-full m-0 text-texte-doux">
                      {e.statut === "PRESENT"
                        ? `Pas encore en salle : en route vers ${e.lieu}. Allez le chercher avec le parent.`
                        : e.statut === "EN_SALLE"
                          ? `En salle : ${e.lieu}. Demandez à la classe de l'amener, ou accompagnez le parent.`
                          : "À l'infirmerie."}
                    </p>
                    {e.alertes.length > 0 ? (
                      <p className="col-span-full m-0 flex gap-2 font-bold text-alerte">
                        <TriangleAlert aria-hidden className="size-5 shrink-0" />
                        Alerte : {e.alertes.join(" · ")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>

              <fieldset className="m-0 grid gap-3 border-0 p-0">
                <legend className="mb-2 font-display text-h3 font-semibold">
                  Qui récupère ? Touchez la photo de l&apos;adulte présent.
                </legend>
                <div className="flex flex-wrap gap-3">
                  {preparation.personnes.map((p) => (
                    <label
                      key={p.id}
                      className="relative grid w-36 cursor-pointer justify-items-center gap-2 rounded-lg bg-creme p-3 text-center has-[:checked]:bg-rose-voile has-[:checked]:ring-[3px] has-[:checked]:ring-rose-fonce has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-bleu"
                    >
                      {/* The whole photo is the touch target: the radio covers it, transparent. */}
                      <input
                        type="radio"
                        name="personne-checkout"
                        className="absolute inset-0 size-full cursor-pointer opacity-0"
                        checked={personneId === p.id}
                        onChange={() => {
                          setPersonneId(p.id);
                          setNonReconnue(false);
                        }}
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated route, not optimisable */}
                      <img
                        src={`/api/fichiers/${p.photoKey}`}
                        alt=""
                        className="size-28 rounded-md object-cover"
                      />
                      <span className="font-bold">
                        {p.prenom} {p.nom}
                      </span>
                      <span className="text-label text-texte-doux">{p.lien}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="rose"
                  size="xl"
                  disabled={enCours || !personneId || !Object.values(coches).some(Boolean)}
                  onClick={valider}
                >
                  Confirmer le retrait
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xl"
                  onClick={() => {
                    setPersonneId(null);
                    setNonReconnue(true);
                  }}
                >
                  <UserX aria-hidden />
                  Personne non reconnue
                </Button>
                <Button type="button" variant="ghost" size="xl" onClick={familleSuivante}>
                  Annuler
                </Button>
              </div>

              {nonReconnue ? (
                <section
                  aria-label="Personne non reconnue"
                  className="grid gap-3 rounded-md bg-rose-voile px-5 py-4"
                >
                  <p role="alert" className="m-0 font-bold text-alerte">
                    Retrait bloqué : cet adulte n&apos;est pas parmi les personnes autorisées.
                    Appelez le contact principal ; le responsable peut ensuite autoriser un retrait
                    exceptionnel.
                  </p>
                  {contact ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-bold">
                        {contact.prenom} {contact.nom}
                        {telephone ? ` · ${formaterTelephone(telephone)}` : ""}
                      </span>
                      {telephone && lienTelephone(telephone) ? (
                        <Button asChild variant="sombre">
                          <a href={lienTelephone(telephone)!}>
                            <Phone aria-hidden />
                            Appeler {contact.prenom}
                          </a>
                        </Button>
                      ) : null}
                      {whatsapp && lienWhatsApp(whatsapp) ? (
                        <Button asChild variant="ghost">
                          <a href={lienWhatsApp(whatsapp)!} target="_blank" rel="noreferrer">
                            <MessageCircle aria-hidden />
                            WhatsApp
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="m-0 flex items-center gap-2">
                      <UserRound aria-hidden className="size-5" />
                      Aucun contact principal enregistré : appelez le responsable.
                    </p>
                  )}
                </section>
              ) : null}
            </div>
          </NotchCard>
        ) : (
          <p className="m-0 hidden items-center gap-3 rounded-lg border-2 border-dashed border-ligne px-6 py-10 text-body-lg text-texte-doux md:landscape:flex">
            Scannez la carte du parent, ou saisissez le code de retrait qu&apos;il vous donne.
          </p>
        )}
      </div>
    </div>
  );
}

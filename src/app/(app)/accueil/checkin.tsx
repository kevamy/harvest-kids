"use client";

import Link from "next/link";
import { CircleCheck, ScanLine, Search, TriangleAlert, UserPlus, UserRound } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { MatriculeBadge } from "@/components/hk/matricule-badge";
import { NotchCard } from "@/components/hk/notch-card";
import { Scanner } from "@/components/hk/scanner";
import { Button } from "@/components/ui/button";
import { appelerAction } from "@/lib/appel-action";
import type { PreparationCheckin, ResultatCheckin } from "@/server/checkin";
import { preparerLeCheckin, rechercherPourCheckin, validerLeCheckin } from "./actions";

export type SessionOuverte = { id: string; libelle: string };

type Choix = Record<string, { coche: boolean; classeId: string }>;
type Trouvee = { id: string; nom: string; prenoms: string[]; brouillon: boolean };

function Photo({ cle, alt }: { cle: string | null; alt: string }) {
  return (
    <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-creme">
      {cle ? (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated route, not optimisable
        <img src={`/api/fichiers/${cle}`} alt={alt} className="size-full object-cover" />
      ) : (
        <UserRound aria-hidden className="size-6 text-texte-doux" />
      )}
    </div>
  );
}

/**
 * Check-in (cahier §7.3): scan the card, or search the family; tick the children present,
 * keep or change the proposed class (RG-17), then "Enregistrer l'arrivée". The confirmation
 * shows, large, the matricules, classes and the family's retrieval code to tell the parent.
 *
 * Built for a handheld scanner: the scan field has the focus when the page opens and gets it
 * back after each confirmation; Enter on the empty field ("Famille suivante") clears the
 * screen, and the next card scanned starts the next family directly. In landscape, the scan
 * sits on the left and the family on the right, so that a family of 3 fits without scrolling.
 */
export function Checkin({ sessions }: { sessions: SessionOuverte[] }) {
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? "");
  const [jeton, setJeton] = useState<string | null>(null);
  const [preparation, setPreparation] = useState<PreparationCheckin | null>(null);
  const [choix, setChoix] = useState<Choix>({});
  const [freres, setFreres] = useState(false);
  const [refus, setRefus] = useState<{ message: string; brouillonId: string | null } | null>(null);
  const [terme, setTerme] = useState("");
  const [trouvees, setTrouvees] = useState<Trouvee[] | null>(null);
  const [resultat, setResultat] = useState<ResultatCheckin | null>(null);
  const [enCours, demarrer] = useTransition();
  const champScan = useRef<HTMLInputElement>(null);

  // On opening, and after each confirmation: the next scan needs no touch on the screen.
  useEffect(() => {
    champScan.current?.focus();
  }, [resultat]);

  const recommencer = () => {
    setJeton(null);
    setPreparation(null);
    setChoix({});
    setFreres(false);
    setRefus(null);
    setTerme("");
    setTrouvees(null);
    setResultat(null);
  };

  const familleSuivante = () => {
    recommencer();
    champScan.current?.focus();
  };

  const preparer = (source: { jeton: string } | { familleId: string }) =>
    demarrer(async () => {
      setRefus(null);
      setResultat(null);
      const reponse = await appelerAction(() => preparerLeCheckin({ sessionId, ...source }));
      if (!reponse.ok) {
        setPreparation(null);
        setRefus({ message: reponse.erreur, brouillonId: null });
        return;
      }
      if ("refus" in reponse.donnees) {
        setPreparation(null);
        setRefus({ message: reponse.donnees.refus, brouillonId: reponse.donnees.brouillonId });
        return;
      }
      const lue = reponse.donnees.preparation;
      setJeton("jeton" in source ? source.jeton : null);
      setPreparation(lue);
      setFreres(lue.carte?.type !== "enfant");
      setTrouvees(null);
      setChoix(
        Object.fromEntries(
          lue.enfants.map((e) => [e.id, { coche: e.coche, classeId: e.classe.proposee ?? "" }]),
        ),
      );
    });

  const valider = () => {
    if (!preparation) return;
    const coches = preparation.enfants.filter((e) => choix[e.id]?.coche);
    if (coches.length === 0) {
      setRefus({ message: "Cochez au moins un enfant.", brouillonId: null });
      return;
    }
    const sansClasse = coches.find((e) => !choix[e.id]?.classeId);
    if (sansClasse) {
      setRefus({ message: `Choisissez la classe de ${sansClasse.prenom}.`, brouillonId: null });
      return;
    }
    demarrer(async () => {
      setRefus(null);
      const reponse = await appelerAction(() =>
        validerLeCheckin({
          sessionId,
          familleId: preparation.famille.id,
          ...(jeton ? { jeton } : {}),
          enfants: coches.map((e) => ({ enfantId: e.id, classeId: choix[e.id]!.classeId })),
        }),
      );
      if (!reponse.ok) {
        setRefus({ message: reponse.erreur, brouillonId: null });
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
          Aucune session ouverte : le responsable ouvre la session avant le culte. Rechargez ensuite
          la page.
        </p>
      </NotchCard>
    );
  }

  // Child card (RG-16): its child only, until "Ajouter ses frères et sœurs".
  const enfantsAffiches = preparation ? preparation.enfants.filter((e) => freres || e.coche) : [];
  const caches = preparation ? preparation.enfants.length - enfantsAffiches.length : 0;

  return (
    <div className="grid items-start gap-4 md:landscape:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <NotchCard couleur="blanc">
        <div className="grid gap-4">
          {sessions.length > 1 ? (
            <div className="grid gap-2">
              <label htmlFor="session-checkin" className="text-label font-bold">
                Session
              </label>
              <select
                id="session-checkin"
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
            </div>
          ) : (
            <p className="m-0 font-bold">{sessions[0]!.libelle}</p>
          )}
          <Scanner
            avecCamera
            champRef={champScan}
            onScan={(valeur) => preparer({ jeton: valeur })}
            onValiderVide={() => {
              if (resultat) familleSuivante();
            }}
          />
          <form
            role="search"
            aria-label="Rechercher une famille"
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              demarrer(async () => {
                setRefus(null);
                const reponse = await appelerAction(() => rechercherPourCheckin(terme));
                if (!reponse.ok) {
                  setRefus({ message: reponse.erreur, brouillonId: null });
                  return;
                }
                setTrouvees(reponse.donnees);
              });
            }}
          >
            <div className="grid min-w-48 flex-1 gap-2">
              <label htmlFor="recherche-checkin" className="text-label font-bold">
                Sans carte : nom, téléphone ou matricule
              </label>
              <input
                id="recherche-checkin"
                type="search"
                value={terme}
                onChange={(e) => setTerme(e.target.value)}
                className="min-h-touch rounded-md bg-blanc px-5 text-body-lg shadow-[inset_0_0_0_2px_var(--color-ligne)]"
              />
            </div>
            <Button type="submit" variant="ghost" disabled={enCours || terme.trim().length < 2}>
              <Search aria-hidden />
              Rechercher
            </Button>
          </form>
          {trouvees ? (
            trouvees.length === 0 ? (
              <p className="m-0 text-texte-doux">
                Aucune famille trouvée. Vérifiez l&apos;orthographe ou cherchez par téléphone.
              </p>
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0" aria-label="Familles trouvées">
                {trouvees.map((f) => (
                  <li key={f.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={() => preparer({ familleId: f.id })}
                    >
                      Famille {f.nom}
                      <span className="truncate font-normal text-texte-doux">
                        {f.brouillon ? "à compléter" : f.prenoms.join(", ")}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      </NotchCard>

      <div className="grid gap-4">
        {refus ? (
          <div
            role="alert"
            className="grid gap-2 rounded-md bg-rose-voile px-5 py-4 font-bold text-alerte"
          >
            <p className="m-0">{refus.message}</p>
            {refus.brouillonId ? (
              <Link href={`/familles/${refus.brouillonId}`}>Ouvrir la fiche pour la finaliser</Link>
            ) : null}
          </div>
        ) : null}

        {resultat ? (
          <NotchCard couleur="blanc" aria-label="Arrivée enregistrée">
            <div className="grid gap-4">
              <p role="status" className="m-0 flex items-center gap-3 font-bold text-succes">
                <CircleCheck aria-hidden className="size-7" />
                Arrivée enregistrée.
              </p>
              <p className="m-0 grid gap-1">
                <span className="text-label font-bold">Code de retrait à donner au parent</span>
                <span
                  className="font-display text-display font-semibold tracking-[6px] text-nuit"
                  aria-label={`Code de retrait : ${resultat.codeRetrait.split("").join(" ")}`}
                >
                  {resultat.codeRetrait}
                </span>
              </p>
              <ul className="m-0 grid list-none gap-3 p-0" aria-label="Enfants enregistrés">
                {resultat.enfants.map((e) => (
                  <li key={e.matricule} className="grid gap-1">
                    <span className="flex flex-wrap items-baseline gap-4">
                      <MatriculeBadge matricule={e.matricule} />
                      <span className="text-h3 font-bold">{e.prenom}</span>
                      <span className="text-body-lg">→ {e.classe}</span>
                    </span>
                    {e.alerte ? (
                      <span className="flex gap-2 font-bold text-alerte">
                        <TriangleAlert aria-hidden className="size-5 shrink-0" />
                        Alerte : {e.alerte}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
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
            aria-label={`Check-in de la famille ${preparation.famille.nom}`}
          >
            <div className="grid gap-4" aria-busy={enCours}>
              <h2 className="m-0 font-display text-h2 font-semibold">
                Famille {preparation.famille.nom}
              </h2>
              {preparation.carte?.enAttente ? (
                <p className="m-0 rounded-md bg-soleil px-4 py-2 text-label text-nuit">
                  Nouvelle carte : elle sera activée par ce check-in, et les anciennes cartes
                  remplacées.
                </p>
              ) : null}
              <ul className="m-0 grid list-none gap-3 p-0" aria-label="Enfants de la famille">
                {enfantsAffiches.map((e) => {
                  const c = choix[e.id] ?? { coche: false, classeId: "" };
                  return (
                    <li
                      key={e.id}
                      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                    >
                      <Photo cle={e.photoKey} alt={`Photo de ${e.prenom}`} />
                      <div className="flex flex-wrap items-center gap-x-3">
                        <label className="flex min-h-touch items-center gap-3">
                          <input
                            type="checkbox"
                            className="size-6 accent-bleu"
                            checked={c.coche}
                            disabled={e.dejaPresent !== null}
                            onChange={(ev) =>
                              setChoix({ ...choix, [e.id]: { ...c, coche: ev.target.checked } })
                            }
                          />
                          <span className="text-h3 font-bold">{e.prenom}</span>
                        </label>
                        <MatriculeBadge matricule={e.matricule} taille="md" />
                        <span className="text-texte-doux">{e.age}</span>
                      </div>
                      {e.dejaPresent ? (
                        <span className="col-span-full font-bold text-texte-doux sm:col-span-1">
                          {e.dejaPresent === "cette_session"
                            ? "Déjà enregistré(e)"
                            : "Encore dans une autre session : faites d'abord son retrait"}
                        </span>
                      ) : (
                        <div className="col-span-full grid gap-1 sm:col-span-1">
                          <label htmlFor={`classe-${e.id}`} className="sr-only">
                            Classe de {e.prenom}
                          </label>
                          <select
                            id={`classe-${e.id}`}
                            value={c.classeId}
                            onChange={(ev) =>
                              setChoix({ ...choix, [e.id]: { ...c, classeId: ev.target.value } })
                            }
                            className="min-h-touch rounded-md bg-blanc px-4 text-body-lg shadow-[inset_0_0_0_2px_var(--color-ligne)]"
                          >
                            <option value="">Choisissez la classe</option>
                            {preparation.classes.map((k) => (
                              <option key={k.id} value={k.id} disabled={!k.ouverte}>
                                {k.ouverte ? k.nom : `${k.nom} (fermée)`}
                                {k.id === e.classe.proposee ? " · proposée" : ""}
                              </option>
                            ))}
                          </select>
                          {e.classe.raison === "aucune" ? (
                            <span className="text-label font-bold text-alerte">
                              Aucune classe ne couvre son âge : choisissez-la à la main.
                            </span>
                          ) : null}
                        </div>
                      )}
                      {e.alerte ? (
                        <p className="col-span-full m-0 flex gap-2 font-bold text-alerte">
                          <TriangleAlert aria-hidden className="size-5 shrink-0" />
                          Alerte : {e.alerte}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {caches > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="justify-self-start"
                  onClick={() => setFreres(true)}
                >
                  <UserPlus aria-hidden />
                  Ajouter ses frères et sœurs
                </Button>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="bleu" size="xl" disabled={enCours} onClick={valider}>
                  Enregistrer l&apos;arrivée
                </Button>
                <Button type="button" variant="ghost" size="xl" onClick={familleSuivante}>
                  Annuler
                </Button>
              </div>
            </div>
          </NotchCard>
        ) : (
          <p className="m-0 hidden items-center gap-3 rounded-lg border-2 border-dashed border-ligne px-6 py-10 text-body-lg text-texte-doux md:landscape:flex">
            <ScanLine aria-hidden className="size-7 shrink-0 text-bleu" />
            Scannez la carte de la famille, ou recherchez-la par son nom.
          </p>
        )}
      </div>
    </div>
  );
}

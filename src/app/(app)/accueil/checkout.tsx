"use client";

import {
  CircleCheck,
  MessageCircle,
  Phone,
  Search,
  TriangleAlert,
  UserRound,
  UserX,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { MatriculeBadge } from "@/components/hk/matricule-badge";
import { NotchCard } from "@/components/hk/notch-card";
import { Scanner } from "@/components/hk/scanner";
import { StatusPill } from "@/components/hk/status-pill";
import { Button } from "@/components/ui/button";
import { appelerAction } from "@/lib/appel-action";
import { formaterTelephone, lienTelephone, lienWhatsApp } from "@/lib/telephone";
import type {
  PreparationCheckout,
  ResultatCheckout,
  ResultatRetraitExceptionnel,
} from "@/server/checkout";
import { reduirePhoto } from "@/lib/photo-navigateur";
import { usePret } from "@/lib/use-pret";
import {
  autoriserRetraitExceptionnel,
  membresPourAutoriser,
  membresPourConfirmer,
  preparerLeCheckout,
  rechercherPourLeCheckout,
  validerLeCheckout,
} from "./actions";
import type { SessionOuverte } from "./checkin";

/** A retrieval code (4 characters, no ambiguous ones, RG-04); anything else is a card token. */
const CODE = /^[2-9A-HJKMNP-Z]{4}$/;

type Autorisateur = { membreId: string; nom: string };

/**
 * Exceptional retrieval (cahier §7.6): after calling the main contact, a RESPONSABLE or an
 * ADMIN authorises it on this tablet with their PIN. The adult's photo is taken with the
 * tablet's camera only (`capture`), after telling them why.
 */
function FormulaireExceptionnel({
  sessionId,
  familleId,
  presenceIds,
  autorisateurs,
  onEnregistre,
}: {
  sessionId: string;
  familleId: string;
  presenceIds: string[];
  autorisateurs: Autorisateur[];
  onEnregistre: (resultat: ResultatRetraitExceptionnel) => void;
}) {
  const [champs, setChamps] = useState({
    nom: "",
    lien: "",
    telephone: "",
    motif: "",
    responsableId: "",
    pin: "",
  });
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const pret = usePret();
  const changer = (nom: keyof typeof champs) => (e: { target: { value: string } }) =>
    setChamps({ ...champs, [nom]: e.target.value });

  useEffect(() => () => (photo ? URL.revokeObjectURL(photo.url) : undefined), [photo]);

  if (autorisateurs.length === 0) {
    return (
      <p role="alert" className="m-0 font-bold text-alerte">
        Aucun responsable ne peut autoriser sur cette tablette : il faut un RESPONSABLE ou un ADMIN
        présent, avec son code PIN.
      </p>
    );
  }

  return (
    <form
      method="post"
      aria-label="Retrait exceptionnel"
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!photo) return;
        const donnees = new FormData();
        donnees.set("sessionId", sessionId);
        donnees.set("familleId", familleId);
        for (const id of presenceIds) donnees.append("presenceIds", id);
        for (const [cle, valeur] of Object.entries(champs)) donnees.set(cle, valeur);
        donnees.set("photo", new File([photo.blob], "adulte.jpg", { type: "image/jpeg" }));
        demarrer(async () => {
          setErreur(null);
          const reponse = await appelerAction(() => autoriserRetraitExceptionnel(donnees));
          setChamps((c) => ({ ...c, pin: "" }));
          if (!reponse.ok) {
            setErreur(reponse.erreur);
            return;
          }
          onEnregistre(reponse.donnees);
        });
      }}
    >
      <p className="m-0 font-bold">
        Après l&apos;appel au contact principal, le responsable peut autoriser ce retrait. Un
        incident est créé.
      </p>
      {erreur ? (
        <p role="alert" className="m-0 font-bold text-alerte">
          {erreur}
        </p>
      ) : null}
      {(
        [
          ["nom", "Nom de l'adulte", true],
          ["lien", "Lien avec l'enfant (facultatif)", false],
          ["telephone", "Téléphone de l'adulte (facultatif)", false],
        ] as const
      ).map(([nom, libelle, requis]) => (
        <div key={nom} className="grid gap-2">
          <label htmlFor={`exceptionnel-${nom}`} className="text-label font-bold">
            {libelle}
          </label>
          <input
            id={`exceptionnel-${nom}`}
            type={nom === "telephone" ? "tel" : "text"}
            required={requis}
            value={champs[nom]}
            onChange={changer(nom)}
            className="min-h-touch rounded-md bg-blanc px-5 text-body-lg shadow-[inset_0_0_0_2px_var(--color-ligne)]"
          />
        </div>
      ))}
      <div className="grid gap-2">
        <label htmlFor="exceptionnel-motif" className="text-label font-bold">
          Motif
        </label>
        <textarea
          id="exceptionnel-motif"
          required
          rows={2}
          maxLength={300}
          value={champs.motif}
          onChange={changer("motif")}
          className="rounded-md bg-blanc px-4 py-3 text-body shadow-[inset_0_0_0_2px_var(--color-ligne)]"
        />
      </div>
      <div className="grid gap-2" aria-describedby="consigne-photo">
        <label htmlFor="exceptionnel-photo" className="text-label font-bold">
          Photo de l&apos;adulte
        </label>
        <p id="consigne-photo" className="m-0 rounded-md bg-soleil px-4 py-2 text-label text-nuit">
          Prévenez la personne que sa photo est prise pour la sécurité de l&apos;enfant.
        </p>
        <input
          id="exceptionnel-photo"
          type="file"
          accept="image/*"
          capture="environment"
          aria-describedby="consigne-photo"
          onChange={async (e) => {
            const fichier = e.target.files?.[0];
            if (!fichier) return;
            try {
              const blob = await reduirePhoto(fichier);
              setPhoto({ blob, url: URL.createObjectURL(blob) });
            } catch {
              setErreur("La photo est illisible. Reprenez-la.");
            }
          }}
        />
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- local preview of the photo taken
          <img src={photo.url} alt="Photo prise" className="size-28 rounded-md object-cover" />
        ) : null}
      </div>
      <div className="grid gap-2">
        <label htmlFor="exceptionnel-responsable" className="text-label font-bold">
          Responsable qui autorise
        </label>
        <select
          id="exceptionnel-responsable"
          required
          value={champs.responsableId}
          onChange={changer("responsableId")}
          className="min-h-touch rounded-md bg-blanc px-5 text-body-lg shadow-[inset_0_0_0_2px_var(--color-ligne)]"
        >
          <option value="">Choisissez le responsable</option>
          {autorisateurs.map((m) => (
            <option key={m.membreId} value={m.membreId}>
              {m.nom}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2">
        <label htmlFor="exceptionnel-pin" className="text-label font-bold">
          Code PIN du responsable
        </label>
        <input
          id="exceptionnel-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          required
          value={champs.pin}
          onChange={(e) => setChamps({ ...champs, pin: e.target.value.replace(/\D/g, "") })}
          className="min-h-touch max-w-60 rounded-md bg-blanc px-5 text-body-lg tracking-[6px] shadow-[inset_0_0_0_2px_var(--color-ligne)]"
        />
      </div>
      <div>
        <Button
          type="submit"
          variant="rose"
          size="xl"
          disabled={
            !pret ||
            enCours ||
            !photo ||
            presenceIds.length === 0 ||
            champs.nom.trim().length < 2 ||
            champs.motif.trim().length < 3 ||
            !champs.responsableId ||
            champs.pin.length !== 6
          }
        >
          Autoriser le retrait exceptionnel
        </Button>
      </div>
    </form>
  );
}

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
  const [moyen, setMoyen] = useState<
    { jeton: string } | { code: string } | { familleId: string } | null
  >(null);
  const [terme, setTerme] = useState("");
  const [trouvees, setTrouvees] = useState<{ id: string; nom: string; prenoms: string[] }[] | null>(
    null,
  );
  // Without card or code: the colleague who confirms, and their PIN (cahier §7.6).
  const [confirmateurs, setConfirmateurs] = useState<{ membreId: string; nom: string }[] | null>(
    null,
  );
  const [second, setSecond] = useState({ membreId: "", pin: "" });
  const [autorisateurs, setAutorisateurs] = useState<Autorisateur[] | null>(null);
  const [exceptionnel, setExceptionnel] = useState<ResultatRetraitExceptionnel | null>(null);
  const pret = usePret();
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
  }, [resultat, exceptionnel, actif]);

  const recommencer = () => {
    setMoyen(null);
    setPreparation(null);
    setCoches({});
    setPersonneId(null);
    setNonReconnue(false);
    setRefus(null);
    setResultat(null);
    setConfirmateurs(null);
    setSecond({ membreId: "", pin: "" });
    setAutorisateurs(null);
    setExceptionnel(null);
  };

  /** Exceptional retrieval: the RESPONSABLE and ADMIN who may authorise are listed first. */
  const demanderAutorisation = () =>
    demarrer(async () => {
      setRefus(null);
      const reponse = await appelerAction(() => membresPourAutoriser());
      if (!reponse.ok) {
        setRefus(reponse.erreur);
        return;
      }
      setAutorisateurs(reponse.donnees);
    });

  const familleSuivante = () => {
    recommencer();
    champScan.current?.focus();
  };

  const preparer = (valeur: string | { familleId: string }) => {
    const saisie = typeof valeur === "string" ? valeur.trim() : "";
    const source =
      typeof valeur !== "string"
        ? valeur
        : CODE.test(saisie.toUpperCase())
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
      setTrouvees(null);
    });
  };

  const rechercher = () =>
    demarrer(async () => {
      setRefus(null);
      const reponse = await appelerAction(() => rechercherPourLeCheckout(sessionId, terme));
      if (!reponse.ok) {
        setRefus(reponse.erreur);
        return;
      }
      setTrouvees(reponse.donnees);
    });

  /** Without card or code, the colleagues who may confirm are listed first. */
  const demanderConfirmation = () =>
    demarrer(async () => {
      setRefus(null);
      const reponse = await appelerAction(() => membresPourConfirmer());
      if (!reponse.ok) {
        setRefus(reponse.erreur);
        return;
      }
      setConfirmateurs(reponse.donnees);
    });

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
          ...("familleId" in moyen ? { secondMembreId: second.membreId, pin: second.pin } : {}),
        }),
      );
      setSecond((s) => ({ ...s, pin: "" }));
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
          <form
            role="search"
            aria-label="Rechercher une famille sans carte ni code"
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              rechercher();
            }}
          >
            <div className="grid min-w-48 flex-1 gap-2">
              <label htmlFor="recherche-checkout" className="text-label font-bold">
                Ni carte ni code : nom, prénom ou matricule
              </label>
              <input
                id="recherche-checkout"
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
                Aucune famille de cette session ne correspond. Vérifiez l&apos;orthographe.
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
                        {f.prenoms.join(", ")}
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
          <p role="alert" className="m-0 rounded-md bg-rose-voile px-5 py-4 font-bold text-alerte">
            {refus}
          </p>
        ) : null}

        {exceptionnel ? (
          <NotchCard couleur="blanc" aria-label="Retrait exceptionnel enregistré">
            <div className="grid gap-4">
              <header>
                <p role="status" className="m-0 flex items-center gap-3 font-bold text-succes">
                  <CircleCheck aria-hidden className="size-7" />
                  Retrait exceptionnel enregistré : {enumerer(exceptionnel.enfants)} remis à{" "}
                  {exceptionnel.nom}. Un incident est créé pour le responsable.
                </p>
              </header>
              <div className="flex flex-wrap items-center gap-4">
                <Button type="button" variant="bleu" size="xl" onClick={familleSuivante}>
                  Famille suivante
                </Button>
              </div>
            </div>
          </NotchCard>
        ) : resultat ? (
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
              {preparation.moyen.type === "recherche" ? (
                <p className="m-0 rounded-md bg-soleil px-4 py-2 text-label text-nuit">
                  Ni carte ni code : vérification renforcée. Touchez la photo de l&apos;adulte, puis
                  un second membre de l&apos;équipe confirme le retrait avec son PIN.
                </p>
              ) : null}
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
                {preparation.moyen.type !== "recherche" ? (
                  <Button
                    type="button"
                    variant="rose"
                    size="xl"
                    disabled={enCours || !personneId || !Object.values(coches).some(Boolean)}
                    onClick={valider}
                  >
                    Confirmer le retrait
                  </Button>
                ) : confirmateurs === null ? (
                  <Button
                    type="button"
                    variant="rose"
                    size="xl"
                    disabled={enCours || !personneId || !Object.values(coches).some(Boolean)}
                    onClick={demanderConfirmation}
                  >
                    Faire confirmer par un collègue
                  </Button>
                ) : null}
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

              {preparation.moyen.type === "recherche" && confirmateurs !== null ? (
                confirmateurs.length === 0 ? (
                  <p role="alert" className="m-0 font-bold text-alerte">
                    Aucun collègue ne peut confirmer sur cette tablette : il faut un autre membre de
                    l&apos;accueil ou un responsable, avec son code PIN.
                  </p>
                ) : (
                  <form
                    method="post"
                    aria-label="Confirmation par un second membre"
                    className="grid gap-3 rounded-md bg-creme px-5 py-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      valider();
                    }}
                  >
                    <p className="m-0 font-bold">
                      Un collègue vérifie l&apos;adulte avec vous, puis confirme avec son PIN.
                    </p>
                    <div className="grid gap-2">
                      <label htmlFor="second-membre" className="text-label font-bold">
                        Second membre
                      </label>
                      <select
                        id="second-membre"
                        required
                        value={second.membreId}
                        onChange={(e) => setSecond({ ...second, membreId: e.target.value })}
                        className="min-h-touch rounded-md bg-blanc px-5 text-body-lg shadow-[inset_0_0_0_2px_var(--color-ligne)]"
                      >
                        <option value="">Choisissez la personne</option>
                        {confirmateurs.map((m) => (
                          <option key={m.membreId} value={m.membreId}>
                            {m.nom}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <label htmlFor="second-pin" className="text-label font-bold">
                        Son code PIN
                      </label>
                      <input
                        id="second-pin"
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={6}
                        required
                        value={second.pin}
                        onChange={(e) =>
                          setSecond({ ...second, pin: e.target.value.replace(/\D/g, "") })
                        }
                        className="min-h-touch max-w-60 rounded-md bg-blanc px-5 text-body-lg tracking-[6px] shadow-[inset_0_0_0_2px_var(--color-ligne)]"
                      />
                    </div>
                    <div>
                      <Button
                        type="submit"
                        variant="rose"
                        size="xl"
                        disabled={
                          !pret ||
                          enCours ||
                          !personneId ||
                          !second.membreId ||
                          second.pin.length !== 6 ||
                          !Object.values(coches).some(Boolean)
                        }
                      >
                        Confirmer le retrait
                      </Button>
                    </div>
                  </form>
                )
              ) : null}

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
                  {autorisateurs === null ? (
                    <div>
                      <Button
                        type="button"
                        variant="sombre"
                        disabled={enCours}
                        onClick={demanderAutorisation}
                      >
                        Retrait exceptionnel avec le responsable
                      </Button>
                    </div>
                  ) : (
                    <FormulaireExceptionnel
                      sessionId={sessionId}
                      familleId={preparation.famille.id}
                      presenceIds={preparation.enfants
                        .filter((e) => coches[e.presenceId])
                        .map((e) => e.presenceId)}
                      autorisateurs={autorisateurs}
                      onEnregistre={(r) => {
                        setPreparation(null);
                        setExceptionnel(r);
                      }}
                    />
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

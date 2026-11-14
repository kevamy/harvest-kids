"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Champ, MessageErreur } from "@/components/ui/champ";
import { GroupeChoix, OptionChoix } from "@/components/ui/choix";
import { appelerAction } from "@/lib/appel-action";
import { JOURS, schemaCulte, type SaisieCulte } from "@/lib/cultes";
import { MessageSucces } from "../entete";
import {
  ajouterCulte,
  enregistrerDelaisAlerte,
  enregistrerLieuRetrait,
  enregistrerLieuxRendezVous,
  mettreAJourCulte,
} from "../actions";

type Message = { ok: boolean; texte: string } | null;

function Retour({ message }: { message: Message }) {
  if (!message) return null;
  return message.ok ? (
    <MessageSucces>{message.texte}</MessageSucces>
  ) : (
    <MessageErreur>{message.texte}</MessageErreur>
  );
}

/** Edits a service, or creates one when `culte` is absent. */
export function FormulaireCulte({ culte }: { culte?: SaisieCulte & { id: string } }) {
  const router = useRouter();
  const prefixe = useId();
  const [message, setMessage] = useState<Message>(null);
  const valeurs: SaisieCulte = culte
    ? {
        nom: culte.nom,
        jour: culte.jour,
        heureDebut: culte.heureDebut,
        heureFin: culte.heureFin,
        actif: culte.actif,
      }
    : { nom: "", jour: 0, heureDebut: "", heureFin: "", actif: true };
  const formulaire = useForm<SaisieCulte>({
    resolver: zodResolver(schemaCulte),
    defaultValues: valeurs,
  });
  const { errors, isSubmitting } = formulaire.formState;
  const id = (champ: string) => `${prefixe}-${champ}`;

  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={formulaire.handleSubmit(async (v) => {
        setMessage(null);
        const resultat = await appelerAction(() =>
          culte ? mettreAJourCulte(culte.id, v) : ajouterCulte(v),
        );
        if (!resultat.ok) {
          setMessage({ ok: false, texte: resultat.erreur });
          return;
        }
        setMessage({ ok: true, texte: culte ? "Culte enregistré." : "Culte ajouté." });
        formulaire.reset(culte ? v : valeurs);
        router.refresh();
      })}
    >
      <Retour message={message} />
      <div className="grid gap-5 md:grid-cols-2">
        <Champ
          id={id("nom")}
          libelle="Nom du culte"
          erreur={errors.nom?.message}
          {...formulaire.register("nom")}
        />
        <div className="grid gap-2">
          <label htmlFor={id("jour")} className="text-label font-bold">
            Jour
          </label>
          <select
            id={id("jour")}
            className="min-h-touch rounded-md bg-blanc px-5 text-body-lg shadow-[inset_0_0_0_2px_var(--color-ligne)]"
            {...formulaire.register("jour", { valueAsNumber: true })}
          >
            {JOURS.map((jour, i) => (
              <option key={jour} value={i}>
                {jour}
              </option>
            ))}
          </select>
        </div>
        <Champ
          id={id("heureDebut")}
          libelle="Heure de début"
          type="time"
          erreur={errors.heureDebut?.message}
          {...formulaire.register("heureDebut")}
        />
        <Champ
          id={id("heureFin")}
          libelle="Heure de fin"
          type="time"
          erreur={errors.heureFin?.message}
          {...formulaire.register("heureFin")}
        />
        <label className="flex min-h-touch items-center gap-3 font-bold">
          <input type="checkbox" className="size-6 accent-bleu" {...formulaire.register("actif")} />
          Culte actif
        </label>
      </div>
      <Button type="submit" variant="bleu" disabled={isSubmitting} className="justify-self-start">
        {culte ? "Enregistrer le culte" : "Ajouter le culte"}
      </Button>
    </form>
  );
}

const minutes = (min: number, max: number) =>
  z
    .number({ message: "Saisissez un nombre de minutes." })
    .int("Saisissez un nombre entier de minutes.")
    .min(min, `Le délai est d'au moins ${min} minute.`)
    .max(max, `Le délai est d'au plus ${max} minutes.`);

// Same bounds as the server (SCHEMAS_PARAMETRES), which checks again.
const schemaDelais = z.object({ nonRecupere: minutes(0, 120), nonArriveEnSalle: minutes(1, 60) });
type Delais = z.infer<typeof schemaDelais>;

export function FormulaireDelais(delais: Delais) {
  const router = useRouter();
  const [message, setMessage] = useState<Message>(null);
  const formulaire = useForm<Delais>({
    resolver: zodResolver(schemaDelais),
    defaultValues: delais,
  });
  const { errors, isSubmitting } = formulaire.formState;
  const nombre = { valueAsNumber: true } as const;

  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={formulaire.handleSubmit(async (v) => {
        setMessage(null);
        const resultat = await appelerAction(() => enregistrerDelaisAlerte(v));
        if (!resultat.ok) {
          setMessage({ ok: false, texte: resultat.erreur });
          return;
        }
        setMessage({ ok: true, texte: "Délais enregistrés." });
        formulaire.reset(v);
        router.refresh();
      })}
    >
      <Retour message={message} />
      <div className="grid gap-5 md:grid-cols-2">
        <Champ
          id="delai-non-recupere"
          libelle="Alerte « non récupéré » après la fin du culte (minutes)"
          type="number"
          inputMode="numeric"
          aide="10 minutes par défaut, entre 0 et 120. L'enfant est alors appelé sur l'écran d'appel."
          erreur={errors.nonRecupere?.message}
          {...formulaire.register("nonRecupere", nombre)}
        />
        <Champ
          id="delai-non-arrive"
          libelle="Alerte « non arrivé en salle » après le check-in (minutes)"
          type="number"
          inputMode="numeric"
          aide="10 minutes par défaut, entre 1 et 60."
          erreur={errors.nonArriveEnSalle?.message}
          {...formulaire.register("nonArriveEnSalle", nombre)}
        />
      </div>
      <Button type="submit" variant="bleu" disabled={isSubmitting} className="justify-self-start">
        Enregistrer les délais
      </Button>
    </form>
  );
}

const LIEUX_MAX = 5;

/** Meeting places offered when a parent is called (cahier §7.5), 1 to 5 places. */
export function FormulaireLieux({ lieux: initiaux }: { lieux: string[] }) {
  const router = useRouter();
  const [lieux, setLieux] = useState(initiaux);
  const [message, setMessage] = useState<Message>(null);
  const [enCours, demarrer] = useTransition();

  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={(evenement) => {
        evenement.preventDefault();
        setMessage(null);
        demarrer(async () => {
          const resultat = await appelerAction(() => enregistrerLieuxRendezVous(lieux));
          if (!resultat.ok) {
            setMessage({ ok: false, texte: resultat.erreur });
            return;
          }
          setMessage({ ok: true, texte: "Lieux de rendez-vous enregistrés." });
          router.refresh();
        });
      }}
    >
      <Retour message={message} />
      <ul className="m-0 grid list-none gap-3 p-0" aria-label="Lieux de rendez-vous">
        {lieux.map((lieu, i) => (
          <li key={i} className="flex items-end gap-3">
            <div className="flex-1">
              <Champ
                id={`lieu-${i}`}
                libelle={`Lieu ${i + 1}`}
                value={lieu}
                maxLength={40}
                onChange={(e) => setLieux(lieux.map((l, j) => (j === i ? e.target.value : l)))}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={lieux.length === 1}
              aria-label={`Retirer le lieu ${i + 1}`}
              onClick={() => setLieux(lieux.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="ghost"
          disabled={lieux.length >= LIEUX_MAX}
          onClick={() => setLieux([...lieux, ""])}
        >
          <Plus aria-hidden />
          Ajouter un lieu
        </Button>
        <Button type="submit" variant="bleu" disabled={enCours}>
          Enregistrer les lieux
        </Button>
      </div>
    </form>
  );
}

type LieuRetrait = "ACCUEIL" | "ACCUEIL_ET_CLASSES";

const RETRAITS: Record<LieuRetrait, { titre: string; description: string }> = {
  ACCUEIL: {
    titre: "À l'accueil seulement",
    description: "Les enfants sont remis aux parents à l'accueil enfants. Recommandé.",
  },
  ACCUEIL_ET_CLASSES: {
    titre: "À l'accueil et à la porte des classes",
    description:
      "Les moniteurs peuvent aussi remettre un enfant depuis leur classe, avec la même vérification des personnes autorisées.",
  },
};

/** Where children are collected (cahier §17, point 3): ADMIN only. */
export function FormulaireLieuRetrait({ lieu: actuel }: { lieu: LieuRetrait }) {
  const router = useRouter();
  const [choix, setChoix] = useState<LieuRetrait>(actuel);
  const [message, setMessage] = useState<Message>(null);
  const [enCours, demarrer] = useTransition();

  return (
    <div className="grid gap-5">
      <Retour message={message} />
      <GroupeChoix legende="Lieu du retrait">
        {(Object.keys(RETRAITS) as LieuRetrait[]).map((lieu) => (
          <OptionChoix
            key={lieu}
            name="lieu-retrait"
            value={lieu}
            checked={choix === lieu}
            onChange={() => {
              setChoix(lieu);
              setMessage(null);
            }}
            titre={RETRAITS[lieu].titre}
            description={RETRAITS[lieu].description}
          />
        ))}
      </GroupeChoix>
      <Button
        type="button"
        variant="bleu"
        disabled={enCours || choix === actuel}
        className="justify-self-start"
        onClick={() => {
          setMessage(null);
          demarrer(async () => {
            const resultat = await appelerAction(() => enregistrerLieuRetrait(choix));
            if (!resultat.ok) {
              setMessage({ ok: false, texte: resultat.erreur });
              return;
            }
            setMessage({ ok: true, texte: "Lieu du retrait enregistré." });
            router.refresh();
          });
        }}
      >
        Enregistrer le lieu du retrait
      </Button>
    </div>
  );
}

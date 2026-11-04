"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Champ, MessageErreur } from "@/components/ui/champ";
import { appelerAction } from "@/lib/appel-action";
import { MessageSucces } from "../entete";
import { ajouterClasse, mettreAJourClasse } from "../actions";

type Classe = {
  id: string;
  nom: string;
  ageMinMois: number;
  ageMaxMois: number;
  salle: string | null;
  capacite: number | null;
  minMoniteurs: number;
  ordre: number;
  active: boolean;
};

const entier = (message: string) => z.number({ message }).int(message);

// Same rules as the server (schemaClasse); the server checks again.
const schemaFormulaire = z
  .object({
    nom: z.string().trim().min(1, "Saisissez le nom de la classe.").max(60),
    ageMinMois: entier("Saisissez un âge en mois.").min(0).max(216),
    ageMaxMois: entier("Saisissez un âge en mois.").min(0).max(216, "216 mois au plus."),
    salle: z.string().trim().max(60),
    capacite: z.union([z.nan(), entier("Saisissez un nombre entier.").min(1).max(500)]),
    minMoniteurs: entier("Saisissez un nombre entier.")
      .min(1, "Il faut au moins 1 moniteur.")
      .max(10, "10 moniteurs au plus."),
    ordre: entier("Saisissez un nombre entier.").min(0).max(999),
    active: z.boolean(),
  })
  .refine((c) => c.ageMaxMois >= c.ageMinMois, {
    message: "L'âge maximum doit être supérieur ou égal à l'âge minimum.",
    path: ["ageMaxMois"],
  });
type Formulaire = z.infer<typeof schemaFormulaire>;

/** Edits a class, or creates one when `classe` is absent. */
export function FormulaireClasse({
  classe,
  ordreSuivant = 1,
}: {
  classe?: Classe;
  ordreSuivant?: number;
}) {
  const router = useRouter();
  const prefixe = useId();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const valeurs: Formulaire = classe
    ? { ...classe, salle: classe.salle ?? "", capacite: classe.capacite ?? Number.NaN }
    : {
        nom: "",
        ageMinMois: 0,
        ageMaxMois: 0,
        salle: "",
        capacite: Number.NaN,
        minMoniteurs: 2,
        ordre: ordreSuivant,
        active: true,
      };
  const formulaire = useForm<Formulaire>({
    resolver: zodResolver(schemaFormulaire),
    defaultValues: valeurs,
  });
  const { errors, isSubmitting } = formulaire.formState;
  const id = (champ: string) => `${prefixe}-${champ}`;
  const nombre = { valueAsNumber: true } as const;

  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={formulaire.handleSubmit(async (v) => {
        setMessage(null);
        const saisie = {
          ...v,
          salle: v.salle || null,
          capacite: Number.isNaN(v.capacite) ? null : v.capacite,
        };
        const resultat = await appelerAction(() =>
          classe ? mettreAJourClasse(classe.id, saisie) : ajouterClasse(saisie),
        );
        if (!resultat.ok) {
          setMessage({ ok: false, texte: resultat.erreur });
          return;
        }
        setMessage({ ok: true, texte: classe ? "Classe enregistrée." : "Classe ajoutée." });
        formulaire.reset(classe ? v : valeurs);
        router.refresh();
      })}
    >
      {message ? (
        message.ok ? (
          <MessageSucces>{message.texte}</MessageSucces>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}
      <div className="grid gap-5 md:grid-cols-2">
        <Champ
          id={id("nom")}
          libelle="Nom de la classe"
          erreur={errors.nom?.message}
          {...formulaire.register("nom")}
        />
        <Champ
          id={id("salle")}
          libelle="Salle"
          erreur={errors.salle?.message}
          {...formulaire.register("salle")}
        />
        <Champ
          id={id("ageMinMois")}
          libelle="Âge minimum (mois)"
          type="number"
          inputMode="numeric"
          erreur={errors.ageMinMois?.message}
          {...formulaire.register("ageMinMois", nombre)}
        />
        <Champ
          id={id("ageMaxMois")}
          libelle="Âge maximum (mois)"
          type="number"
          inputMode="numeric"
          erreur={errors.ageMaxMois?.message}
          {...formulaire.register("ageMaxMois", nombre)}
        />
        <Champ
          id={id("capacite")}
          libelle="Capacité (facultatif)"
          type="number"
          inputMode="numeric"
          erreur={errors.capacite?.message}
          {...formulaire.register("capacite", nombre)}
        />
        <Champ
          id={id("minMoniteurs")}
          libelle="Nombre minimum de moniteurs"
          type="number"
          inputMode="numeric"
          erreur={errors.minMoniteurs?.message}
          {...formulaire.register("minMoniteurs", nombre)}
        />
        <Champ
          id={id("ordre")}
          libelle="Ordre"
          type="number"
          inputMode="numeric"
          aide="Ordre d'affichage ; en cas de chevauchement, la première classe est proposée."
          erreur={errors.ordre?.message}
          {...formulaire.register("ordre", nombre)}
        />
        <label className="flex min-h-touch items-center gap-3 self-end font-bold">
          <input
            type="checkbox"
            className="size-6 accent-bleu"
            {...formulaire.register("active")}
          />
          Classe active
        </label>
      </div>
      <Button type="submit" variant="bleu" disabled={isSubmitting} className="justify-self-start">
        {classe ? "Enregistrer la classe" : "Ajouter la classe"}
      </Button>
    </form>
  );
}

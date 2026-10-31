"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Champ, MessageErreur } from "@/components/ui/champ";
import { appelerAction } from "@/lib/appel-action";
import { MessageSucces } from "../entete";
import { enregistrerDelaiPurge } from "../actions";

const schemaFormulaire = z.object({
  jours: z
    .number({ message: "Saisissez un nombre de jours." })
    .int("Saisissez un nombre entier de jours.")
    .min(7, "Le délai est d'au moins 7 jours.")
    .max(730, "Le délai est d'au plus 730 jours."),
});
type Formulaire = z.infer<typeof schemaFormulaire>;

export function FormulaireDelaiPurge({ jours }: { jours: number }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const formulaire = useForm<Formulaire>({
    resolver: zodResolver(schemaFormulaire),
    defaultValues: { jours },
  });
  const { errors, isSubmitting } = formulaire.formState;

  return (
    <form
      noValidate
      className="grid max-w-md gap-5"
      onSubmit={formulaire.handleSubmit(async (v) => {
        setMessage(null);
        const resultat = await appelerAction(() => enregistrerDelaiPurge(v.jours));
        if (!resultat.ok) {
          setMessage({ ok: false, texte: resultat.erreur });
          return;
        }
        setMessage({ ok: true, texte: "Délai enregistré." });
        formulaire.reset(v);
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
      <Champ
        id="jours"
        libelle="Délai avant suppression d'un brouillon (en jours)"
        type="number"
        inputMode="numeric"
        min={7}
        max={730}
        aide="90 jours par défaut, entre 7 et 730 jours."
        erreur={errors.jours?.message}
        {...formulaire.register("jours", { valueAsNumber: true })}
      />
      <Button type="submit" variant="bleu" disabled={isSubmitting} className="justify-self-start">
        Enregistrer le délai
      </Button>
    </form>
  );
}

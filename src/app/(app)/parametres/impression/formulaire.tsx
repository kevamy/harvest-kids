"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { GroupeChoix, OptionChoix } from "@/components/ui/choix";
import { MessageErreur } from "@/components/ui/champ";
import { appelerAction } from "@/lib/appel-action";
import { dimensionsLisibles, type FormatCarte, type IdFormat } from "@/server/impression/formats";
import { MessageSucces } from "../entete";
import { enregistrerImpression } from "../actions";

type Impression = { format: IdFormat; rectoVerso: boolean };

export function FormulaireImpression({
  formats,
  valeurs,
}: {
  formats: readonly FormatCarte[];
  valeurs: Impression;
}) {
  const router = useRouter();
  const [choix, setChoix] = useState<Impression>(valeurs);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();
  const change = choix.format !== valeurs.format || choix.rectoVerso !== valeurs.rectoVerso;

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        demarrer(async () => {
          setMessage(null);
          const resultat = await appelerAction(() => enregistrerImpression(choix));
          if (!resultat.ok) {
            setMessage({ ok: false, texte: resultat.erreur });
            return;
          }
          setMessage({ ok: true, texte: "Réglages d'impression enregistrés." });
          router.refresh();
        });
      }}
    >
      {message ? (
        message.ok ? (
          <MessageSucces>{message.texte}</MessageSucces>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}
      <GroupeChoix legende="Format par défaut">
        <div className="grid gap-3 md:grid-cols-2">
          {formats.map((format) => (
            <OptionChoix
              key={format.id}
              name="format"
              value={format.id}
              checked={choix.format === format.id}
              onChange={() => setChoix({ ...choix, format: format.id })}
              titre={format.libelle}
              description={`${dimensionsLisibles(format)}, ${format.orientation}. ${format.usage}.`}
            />
          ))}
        </div>
      </GroupeChoix>
      <GroupeChoix legende="Faces imprimées">
        <OptionChoix
          name="faces"
          value="recto"
          checked={!choix.rectoVerso}
          onChange={() => setChoix({ ...choix, rectoVerso: false })}
          titre="Recto seul"
          description="Le téléphone de l'accueil et une consigne courte passent au recto."
        />
        <OptionChoix
          name="faces"
          value="recto-verso"
          checked={choix.rectoVerso}
          onChange={() => setChoix({ ...choix, rectoVerso: true })}
          titre="Recto-verso"
          description="Les consignes de dépôt et de retrait sont imprimées au verso."
        />
      </GroupeChoix>
      <Button
        type="submit"
        variant="bleu"
        className="justify-self-start"
        disabled={!change || enCours}
      >
        Enregistrer les réglages d&apos;impression
      </Button>
    </form>
  );
}

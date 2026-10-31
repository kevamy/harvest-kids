"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GroupeChoix, OptionChoix } from "@/components/ui/choix";
import { MessageErreur } from "@/components/ui/champ";
import { appelerAction } from "@/lib/appel-action";
import { MessageSucces } from "../entete";
import { enregistrerModeCarte } from "../actions";

type Mode = "FAMILLE" | "ENFANT";

const LIBELLES: Record<Mode, { titre: string; description: string }> = {
  FAMILLE: {
    titre: "Une carte par famille",
    description: "Un scan ouvre tous les enfants de la famille. Recommandé.",
  },
  ENFANT: {
    titre: "Une carte par enfant",
    description:
      "Un scan ouvre l'enfant concerné, avec un raccourci pour ajouter ses frères et sœurs.",
  },
};

/**
 * RG-16: changing the mode never invalidates a card. The administrator is warned
 * before the change is saved.
 */
export function FormulaireModeCarte({ modeActuel }: { modeActuel: Mode }) {
  const router = useRouter();
  const [choix, setChoix] = useState<Mode>(modeActuel);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();
  const change = choix !== modeActuel;

  return (
    <div className="grid gap-5">
      {message ? (
        message.ok ? (
          <MessageSucces>{message.texte}</MessageSucces>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}
      <GroupeChoix legende="Mode de carte">
        {(Object.keys(LIBELLES) as Mode[]).map((mode) => (
          <OptionChoix
            key={mode}
            name="mode"
            value={mode}
            checked={choix === mode}
            onChange={() => {
              setChoix(mode);
              setMessage(null);
            }}
            titre={LIBELLES[mode].titre}
            description={
              mode === modeActuel
                ? `${LIBELLES[mode].description} Mode actuel.`
                : LIBELLES[mode].description
            }
          />
        ))}
      </GroupeChoix>
      {change ? (
        <div role="note" className="flex gap-3 rounded-md bg-soleil px-5 py-4 text-nuit">
          <TriangleAlert aria-hidden className="mt-0.5 size-6 shrink-0" />
          <p className="m-0">
            Les cartes déjà remises restent valides jusqu&apos;à leur révocation. Seules les
            nouvelles cartes seront émises en mode « {LIBELLES[choix].titre.toLowerCase()} ». Pour
            les familles déjà inscrites, réémettez ensuite les cartes ci-dessous.
          </p>
        </div>
      ) : null}
      <Button
        variant="bleu"
        className="justify-self-start"
        disabled={!change || enCours}
        onClick={() =>
          demarrer(async () => {
            setMessage(null);
            const resultat = await appelerAction(() => enregistrerModeCarte(choix));
            if (!resultat.ok) {
              setMessage({ ok: false, texte: resultat.erreur });
              return;
            }
            setMessage({ ok: true, texte: "Mode de carte changé." });
            router.refresh();
          })
        }
      >
        Changer le mode de carte
      </Button>
    </div>
  );
}

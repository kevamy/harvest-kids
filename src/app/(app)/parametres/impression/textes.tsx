"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Champ, MessageErreur } from "@/components/ui/champ";
import { appelerAction } from "@/lib/appel-action";
import { LIMITES_TEXTES_CARTE as L, type TextesCarte } from "@/server/impression/textes";
import { MessageSucces } from "../entete";
import { enregistrerTextesCarte } from "../actions";

const compteur = (texte: string, max: number) => `${texte.trim().length} / ${max} caractères.`;

/**
 * Card texts of the church (cahier §7.1, §7.10): front footer (front-only printing) and
 * back instructions. The lengths are capped so that the text fits all five formats; the
 * server validates again and measures the text before saving.
 */
export function FormulaireTextesCarte({
  valeurs,
  telephoneAccueil,
}: {
  valeurs: TextesCarte;
  /** Reception phone of the church profile, formatted, or null when not set. */
  telephoneAccueil: string | null;
}) {
  const router = useRouter();
  const [textes, setTextes] = useState<TextesCarte>(valeurs);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();
  const majConsigne = (i: number, texte: string) =>
    setTextes({
      ...textes,
      consignesVerso: textes.consignesVerso.map((c, j) => (j === i ? texte : c)),
    });

  return (
    <form
      noValidate
      className="grid max-w-2xl gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        demarrer(async () => {
          setMessage(null);
          const resultat = await appelerAction(() => enregistrerTextesCarte(textes));
          if (!resultat.ok) {
            setMessage({ ok: false, texte: resultat.erreur });
            return;
          }
          setMessage({ ok: true, texte: "Textes de la carte enregistrés." });
          router.refresh();
        });
      }}
    >
      <div>
        <h2 className="m-0 mb-2 font-display text-h2 font-semibold">Textes de la carte</h2>
        <p className="m-0 text-texte-doux">
          Les longueurs sont limitées pour que le texte tienne dans les cinq formats. Les aperçus et
          les PDF reprennent ces textes.
        </p>
      </div>
      {message ? (
        message.ok ? (
          <MessageSucces>{message.texte}</MessageSucces>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}

      <label className="flex min-h-touch items-center gap-3 font-bold">
        <input
          type="checkbox"
          name="afficherTelephone"
          className="size-6 accent-bleu"
          checked={textes.afficherTelephone}
          onChange={(e) => setTextes({ ...textes, afficherTelephone: e.target.checked })}
        />
        Afficher le téléphone de l&apos;accueil enfants
        {telephoneAccueil ? ` (${telephoneAccueil})` : null}
      </label>
      {textes.afficherTelephone && !telephoneAccueil ? (
        <p className="m-0 text-label text-texte-doux">
          Aucun téléphone n&apos;est enregistré : renseignez-le dans Paramètres › Église.
        </p>
      ) : null}

      <Champ
        id="consigneCourte"
        name="consigneCourte"
        libelle="Consigne courte du recto"
        maxLength={L.consigneCourte}
        value={textes.consigneCourte}
        onChange={(e) => setTextes({ ...textes, consigneCourte: e.target.value })}
        aide={`Imprimée en pied de recto quand la carte est imprimée en recto seul. ${compteur(textes.consigneCourte, L.consigneCourte)}`}
      />

      <Champ
        id="titreVerso"
        name="titreVerso"
        libelle="Titre du verso"
        maxLength={L.titreVerso}
        value={textes.titreVerso}
        onChange={(e) => setTextes({ ...textes, titreVerso: e.target.value })}
        aide={compteur(textes.titreVerso, L.titreVerso)}
      />

      <fieldset className="m-0 grid gap-4 border-0 p-0">
        <legend className="mb-2 text-label font-bold">
          Consignes du verso ({L.nombreConsignesVerso} au plus)
        </legend>
        {textes.consignesVerso.map((consigne, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="flex-1">
              <Champ
                id={`consigneVerso-${i}`}
                name={`consigneVerso-${i}`}
                libelle={`Consigne ${i + 1}`}
                maxLength={L.consigneVerso}
                value={consigne}
                onChange={(e) => majConsigne(i, e.target.value)}
                aide={compteur(consigne, L.consigneVerso)}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-8"
              aria-label={`Retirer la consigne ${i + 1}`}
              disabled={textes.consignesVerso.length <= 1}
              onClick={() =>
                setTextes({
                  ...textes,
                  consignesVerso: textes.consignesVerso.filter((_, j) => j !== i),
                })
              }
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          className="justify-self-start"
          disabled={textes.consignesVerso.length >= L.nombreConsignesVerso}
          onClick={() => setTextes({ ...textes, consignesVerso: [...textes.consignesVerso, ""] })}
        >
          <Plus aria-hidden /> Ajouter une consigne
        </Button>
      </fieldset>

      <Button type="submit" variant="bleu" disabled={enCours} className="justify-self-start">
        Enregistrer les textes de la carte
      </Button>
    </form>
  );
}

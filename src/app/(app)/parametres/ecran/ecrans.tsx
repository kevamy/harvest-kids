"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { NotchCard } from "@/components/hk/notch-card";
import { Button } from "@/components/ui/button";
import { MessageErreur } from "@/components/ui/champ";
import { LienUnique } from "@/components/ui/lien-unique";
import { ModaleConfirmation } from "@/components/ui/modale-confirmation";
import { appelerAction } from "@/lib/appel-action";
import type { EcranListe, EtatEcran } from "@/server/plateforme/ecran";
import { MessageSucces } from "../entete";
import { ajouterEcran, retirerEcran } from "./actions";

const ETATS: Record<EtatEcran, string> = {
  en_attente: "Lien à ouvrir sur l'appareil",
  lien_expire: "Lien expiré : retirez cet écran et ajoutez-en un autre",
  appaire: "Appairé",
  revoque: "Retiré",
};

function description(e: EcranListe): string {
  const parties = [ETATS[e.etat], `ajouté le ${e.creeLe}`];
  if (e.appaireLe) parties.push(`appairé le ${e.appaireLe}`);
  if (e.derniereVue) parties.push(`vu pour la dernière fois le ${e.derniereVue}`);
  return parties.join(" · ");
}

export function Ecrans({ ecrans }: { ecrans: EcranListe[] }) {
  const router = useRouter();
  const [nom, setNom] = useState("");
  const [lien, setLien] = useState<{ nom: string; lien: string } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [aRetirer, setARetirer] = useState<EcranListe | null>(null);
  const [enCours, demarrer] = useTransition();

  return (
    <div className="grid gap-6">
      {message ? (
        message.ok ? (
          <MessageSucces>{message.texte}</MessageSucces>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}
      {lien ? (
        <LienUnique
          titre={`Lien d'appairage de « ${lien.nom} »`}
          lien={lien.lien}
          validite="24 heures"
          destinataire="Ouvrez ce lien sur l'appareil de l'écran (télévision, tablette, ordinateur de la salle)."
          onFermer={() => setLien(null)}
        />
      ) : null}

      <NotchCard couleur="blanc" aria-label="Ajouter un écran">
        <form
          className="grid gap-4"
          onSubmit={(evenement) => {
            evenement.preventDefault();
            demarrer(async () => {
              setMessage(null);
              const resultat = await appelerAction(() => ajouterEcran(nom));
              if (!resultat.ok) {
                setMessage({ ok: false, texte: resultat.erreur });
                return;
              }
              setLien({ nom: nom.trim(), lien: resultat.donnees.lien });
              setMessage({ ok: true, texte: `Écran « ${nom.trim()} » ajouté.` });
              setNom("");
              router.refresh();
            });
          }}
        >
          <h2 className="m-0 font-display text-h2 font-semibold">Ajouter un écran</h2>
          <label className="grid max-w-md gap-2 font-bold">
            Nom de l&apos;écran
            <input
              className="min-h-touch rounded-md border-2 border-nuit bg-blanc px-4 font-normal"
              value={nom}
              maxLength={60}
              placeholder="Salle principale"
              onChange={(e) => setNom(e.target.value)}
            />
          </label>
          <Button type="submit" variant="bleu" disabled={enCours} className="justify-self-start">
            Ajouter l&apos;écran
          </Button>
        </form>
      </NotchCard>

      <section aria-labelledby="ecrans" className="grid gap-3">
        <h2 id="ecrans" className="m-0 font-display text-h2 font-semibold">
          Écrans de l&apos;église
        </h2>
        {ecrans.length === 0 ? (
          <p className="m-0 text-texte-doux">Aucun écran pour l&apos;instant.</p>
        ) : (
          <ul aria-label="Écrans" className="m-0 grid list-none gap-3 p-0">
            {ecrans.map((e) => (
              <li
                key={e.id}
                aria-label={e.nom}
                aria-describedby={`ecran-${e.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-blanc px-5 py-4 shadow-card"
              >
                <div className="grid gap-1">
                  <span className="font-bold">{e.nom}</span>
                  <span id={`ecran-${e.id}`} className="text-label text-texte-doux">
                    {description(e)}
                  </span>
                </div>
                {e.etat !== "revoque" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={enCours}
                    aria-label={`Retirer l'écran ${e.nom}`}
                    onClick={() => setARetirer(e)}
                  >
                    Retirer
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ModaleConfirmation
        ouverte={aRetirer !== null}
        titre={`Retirer l'écran « ${aRetirer?.nom ?? ""} » ?`}
        libelleConfirmer="Retirer l'écran"
        enCours={enCours}
        onAnnuler={() => setARetirer(null)}
        onConfirmer={() =>
          demarrer(async () => {
            const ecran = aRetirer!;
            const resultat = await appelerAction(() => retirerEcran(ecran.id));
            setARetirer(null);
            setMessage(
              resultat.ok
                ? { ok: true, texte: `Écran « ${ecran.nom} » retiré.` }
                : { ok: false, texte: resultat.erreur },
            );
            router.refresh();
          })
        }
      >
        <p className="m-0">
          L&apos;appareil n&apos;affichera plus les appels. Pour le remettre en service, ajoutez un
          nouvel écran et ouvrez son lien sur l&apos;appareil.
        </p>
      </ModaleConfirmation>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Champ, MessageErreur } from "@/components/ui/champ";
import { RESEAU_INDISPONIBLE } from "@/lib/appel-action";
import { MessageSucces } from "../entete";

export type ReemissionAffichee = {
  id: string;
  creeLe: string;
  mode: string;
  dernierJour: string | null;
  cartes: number;
};

/**
 * Bulk reissue (RG-16): new pending cards for every finalised family, in the current mode,
 * downloaded as one PDF. The cards in circulation stay valid until each new card is handed
 * over or first scanned, or until the optional deadline.
 */
export function ReemissionCartes({
  mode,
  familles,
  cartes,
  demain,
  dernierJourMax,
  historique,
}: {
  mode: string;
  familles: number;
  cartes: number;
  /** Earliest and latest deadlines accepted ("YYYY-MM-DD", church time zone). */
  demain: string;
  dernierJourMax: string;
  historique: ReemissionAffichee[];
}) {
  const router = useRouter();
  const [dernierJour, setDernierJour] = useState("");
  const [confirmation, setConfirmation] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  const reemettre = () =>
    demarrer(async () => {
      setMessage(null);
      try {
        const reponse = await fetch("/api/impression/reemission", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dernierJour: dernierJour || null }),
        });
        if (!reponse.ok) {
          const corps = await reponse.json().catch(() => null);
          setMessage({ ok: false, texte: corps?.erreur ?? "La réémission a échoué. Réessayez." });
          return;
        }
        const lien = document.createElement("a");
        lien.href = URL.createObjectURL(await reponse.blob());
        lien.download = "reemission-cartes.pdf";
        lien.click();
        URL.revokeObjectURL(lien.href);
        const n = reponse.headers.get("X-Cartes") ?? String(cartes);
        setMessage({
          ok: true,
          texte: `Cartes réémises : ${n} carte(s) à remettre aux familles.`,
        });
        setConfirmation(false);
        router.refresh();
      } catch {
        setMessage({ ok: false, texte: RESEAU_INDISPONIBLE });
      }
    });

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="m-0 mb-2 font-display text-h2 font-semibold">Réémettre toutes les cartes</h2>
        <p className="m-0 text-texte-doux">
          Après un changement de mode, de logo ou de format : une nouvelle carte pour chaque famille
          inscrite, en mode « {mode} ». Les cartes en circulation restent valides jusqu&apos;à la
          remise de la nouvelle carte ou son premier scan.
        </p>
      </div>
      {message ? (
        message.ok ? (
          <MessageSucces>{message.texte}</MessageSucces>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}
      <p className="m-0" data-testid="reemission-volume">
        {familles} famille(s) inscrite(s), {cartes} carte(s) à imprimer.
      </p>
      <div className="max-w-sm">
        <Champ
          id="dernierJour"
          name="dernierJour"
          type="date"
          libelle="Dernier jour de validité des anciennes cartes (facultatif)"
          min={demain}
          max={dernierJourMax}
          value={dernierJour}
          onChange={(e) => {
            setDernierJour(e.target.value);
            setConfirmation(false);
          }}
          aide="Sans date, une ancienne carte reste valide jusqu'à la remise de la nouvelle."
        />
      </div>
      {confirmation ? (
        <div className="grid gap-3">
          <p role="note" className="m-0 rounded-md bg-soleil px-5 py-4 text-nuit">
            {cartes} carte(s) seront émises et le PDF téléchargé.
            {dernierJour
              ? " Après la date limite, les anciennes cartes seront refusées."
              : " Les anciennes cartes restent valides jusqu'à la remise des nouvelles."}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="bleu" disabled={enCours} onClick={reemettre}>
              <Printer aria-hidden /> Confirmer la réémission
            </Button>
            <Button variant="ghost" disabled={enCours} onClick={() => setConfirmation(false)}>
              Annuler
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="bleu"
          className="justify-self-start"
          disabled={cartes === 0 || enCours}
          onClick={() => {
            setMessage(null);
            setConfirmation(true);
          }}
        >
          <Printer aria-hidden /> Réémettre les cartes
        </Button>
      )}
      {historique.length > 0 ? (
        <section aria-labelledby="historique-reemissions" className="grid gap-2">
          <h3 id="historique-reemissions" className="m-0 text-label font-bold">
            Dernières réémissions
          </h3>
          <ul className="m-0 grid list-none gap-1 p-0 text-label">
            {historique.map((r) => (
              <li key={r.id}>
                {r.creeLe} · mode « {r.mode} » · {r.cartes} carte(s)
                {r.dernierJour ? ` · anciennes cartes valides jusqu'au ${r.dernierJour}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

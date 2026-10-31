"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageErreur } from "@/components/ui/champ";
import { appelerAction, RESEAU_INDISPONIBLE } from "@/lib/appel-action";
import { remettreCarte, retirerCarte } from "../../cartes/actions";

export type CarteAffichee = {
  id: string;
  emiseLe: string;
  activeLe: string | null;
  revoqueeLe: string | null;
  enfant: string | null;
};

const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" });
const etat = (c: CarteAffichee) =>
  c.revoqueeLe ? "révoquée" : c.activeLe ? "active" : "en attente de remise";

/**
 * Cards of a family (RG-16, ADR 0008). Printing issues the cards and downloads the PDF,
 * the only place where the tokens exist: a reprint stays pending until handed over.
 */
export function CartesFamille({
  familleId,
  cartes,
}: {
  familleId: string;
  cartes: CarteAffichee[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  const imprimer = (perdue: boolean) =>
    demarrer(async () => {
      setMessage(null);
      try {
        const reponse = await fetch("/api/impression/cartes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ familleId, perdue }),
        });
        if (!reponse.ok) {
          const corps = await reponse.json().catch(() => null);
          setMessage({ ok: false, texte: corps?.erreur ?? "L'impression a échoué. Réessayez." });
          return;
        }
        const nom = /filename="([^"]+)"/.exec(
          reponse.headers.get("Content-Disposition") ?? "",
        )?.[1];
        const lien = document.createElement("a");
        lien.href = URL.createObjectURL(await reponse.blob());
        lien.download = nom ?? "cartes.pdf";
        lien.click();
        URL.revokeObjectURL(lien.href);
        setMessage({
          ok: true,
          texte: perdue
            ? "Carte perdue remplacée : l'ancienne est révoquée, la nouvelle est active."
            : "Carte imprimée. Remettez-la à la famille.",
        });
        router.refresh();
      } catch {
        setMessage({ ok: false, texte: RESEAU_INDISPONIBLE });
      }
    });

  const agir = (
    action: () => Promise<{ ok: true } | { ok: false; erreur: string }>,
    succes: string,
  ) =>
    demarrer(async () => {
      setMessage(null);
      const reponse = await appelerAction(action);
      setMessage(reponse.ok ? { ok: true, texte: succes } : { ok: false, texte: reponse.erreur });
      if (reponse.ok) router.refresh();
    });

  const actives = cartes.filter((c) => c.activeLe && !c.revoqueeLe);

  return (
    <div className="grid gap-4">
      {message ? (
        message.ok ? (
          <p role="status" className="m-0 rounded-md bg-bleu-voile px-5 py-4 font-bold text-nuit">
            {message.texte}
          </p>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="bleu" disabled={enCours} onClick={() => imprimer(false)}>
          <Printer aria-hidden />
          Imprimer la carte
        </Button>
        {actives.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            disabled={enCours}
            onClick={() => {
              if (
                window.confirm(
                  "La carte actuelle ne sera plus acceptée. Imprimer une nouvelle carte ?",
                )
              ) {
                imprimer(true);
              }
            }}
          >
            Carte perdue
          </Button>
        ) : null}
      </div>
      {cartes.length === 0 ? (
        <p className="m-0 text-texte-doux">Aucune carte pour l&apos;instant.</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Cartes de la famille">
          {cartes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3">
              <span className={c.revoqueeLe ? "text-texte-doux" : "font-bold"}>
                {c.enfant ? `Carte de ${c.enfant}` : "Carte famille"} · émise le{" "}
                {DATE.format(new Date(c.emiseLe))} · {etat(c)}
              </span>
              {!c.revoqueeLe && !c.activeLe ? (
                <Button
                  type="button"
                  variant="bleu"
                  disabled={enCours}
                  onClick={() =>
                    agir(
                      () => remettreCarte(c.id, familleId),
                      "Carte remise : elle est active, l'ancienne carte est révoquée.",
                    )
                  }
                >
                  Remettre la carte
                </Button>
              ) : null}
              {!c.revoqueeLe ? (
                <Button
                  type="button"
                  variant="lien"
                  disabled={enCours}
                  onClick={() => {
                    if (window.confirm("Cette carte ne sera plus acceptée. La retirer ?")) {
                      agir(() => retirerCarte(c.id, familleId), "Carte retirée.");
                    }
                  }}
                >
                  Retirer la carte
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageErreur } from "@/components/ui/champ";
import { RESEAU_INDISPONIBLE } from "@/lib/appel-action";
import { MessageSucces } from "../entete";

export type MoniteurAffiche = { membreId: string; nom: string; badgeEmisLe: string | null };

/**
 * Monitor badges (cahier §7.10). Printing issues the badge and downloads the PDF, the only
 * place where the token exists: the new badge is active at once and the previous one is
 * refused from then on ("Ce badge a été remplacé").
 */
export function BadgesMoniteurs({ moniteurs }: { moniteurs: MoniteurAffiche[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  const imprimer = (membreIds?: string[]) =>
    demarrer(async () => {
      setMessage(null);
      try {
        const reponse = await fetch("/api/impression/badges", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ membreIds }),
        });
        if (!reponse.ok) {
          const corps = await reponse.json().catch(() => null);
          setMessage({ ok: false, texte: corps?.erreur ?? "L'impression a échoué. Réessayez." });
          return;
        }
        const lien = document.createElement("a");
        lien.href = URL.createObjectURL(await reponse.blob());
        lien.download = "badges-moniteurs.pdf";
        lien.click();
        URL.revokeObjectURL(lien.href);
        const n = Number(reponse.headers.get("X-Badges") ?? membreIds?.length ?? 0);
        setMessage({
          ok: true,
          texte:
            n === 1
              ? "Badge imprimé. Remettez-le au moniteur : l'ancien badge est désormais refusé."
              : `Badges imprimés : ${n}. Remettez-les aux moniteurs : les anciens badges sont désormais refusés.`,
        });
        router.refresh();
      } catch {
        setMessage({ ok: false, texte: RESEAU_INDISPONIBLE });
      }
    });

  if (moniteurs.length === 0) {
    return (
      <p className="m-0 text-texte-doux">
        Aucun moniteur actif dans l&apos;église. Un compte reçoit un badge dès qu&apos;il a le rôle
        Moniteur.
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      {message ? (
        message.ok ? (
          <MessageSucces>{message.texte}</MessageSucces>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}
      <Button
        variant="bleu"
        className="justify-self-start"
        disabled={enCours}
        onClick={() => imprimer()}
      >
        <Printer aria-hidden /> Imprimer tous les badges ({moniteurs.length})
      </Button>
      <ul className="m-0 grid list-none gap-3 p-0" aria-label="Moniteurs">
        {moniteurs.map((m) => (
          <li
            key={m.membreId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-creme px-5 py-3"
          >
            <span className="grid gap-1">
              <span className="font-bold text-nuit">{m.nom}</span>
              <span className="text-label text-texte-doux">
                {m.badgeEmisLe ? `Badge actif depuis le ${m.badgeEmisLe}` : "Aucun badge"}
              </span>
            </span>
            <Button
              variant="ghost"
              disabled={enCours}
              aria-label={`Imprimer le badge de ${m.nom}`}
              onClick={() => imprimer([m.membreId])}
            >
              <Printer aria-hidden /> Imprimer le badge
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

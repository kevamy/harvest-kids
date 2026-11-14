"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { MessageErreur } from "@/components/ui/champ";
import { appelerAction } from "@/lib/appel-action";
import { MessageSucces } from "../parametres/entete";
import { cloturerLaSession, ouvrirLaSession } from "./actions";

/** "Ouvrir la session" or "Clôturer la session", with the server's answer. */
export function BoutonSession({
  sessionId,
  action,
}: {
  sessionId: string;
  action: "ouvrir" | "cloturer";
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  return (
    <div className="grid gap-3">
      {message ? (
        message.ok ? (
          <MessageSucces>{message.texte}</MessageSucces>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}
      <Button
        type="button"
        variant={action === "ouvrir" ? "bleu" : "ghost"}
        disabled={enCours}
        className="justify-self-start"
        onClick={() =>
          demarrer(async () => {
            setMessage(null);
            const resultat = await appelerAction(() =>
              action === "ouvrir" ? ouvrirLaSession(sessionId) : cloturerLaSession(sessionId),
            );
            if (!resultat.ok) {
              setMessage({ ok: false, texte: resultat.erreur });
              return;
            }
            setMessage({
              ok: true,
              texte: action === "ouvrir" ? "Session ouverte." : "Session clôturée.",
            });
            router.refresh();
          })
        }
      >
        {action === "ouvrir" ? "Ouvrir la session" : "Clôturer la session"}
      </Button>
    </div>
  );
}

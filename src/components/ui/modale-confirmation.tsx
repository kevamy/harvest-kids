"use client";

import { useEffect, useRef } from "react";
import { Button } from "./button";

/**
 * Explicit confirmation of an action with immediate effect. Native <dialog> opened with
 * showModal(): the browser keeps the focus inside, Escape cancels, the page behind is inert.
 */
export function ModaleConfirmation({
  ouverte,
  titre,
  children,
  libelleConfirmer,
  enCours,
  onConfirmer,
  onAnnuler,
}: {
  ouverte: boolean;
  titre: string;
  children: React.ReactNode;
  libelleConfirmer: string;
  enCours?: boolean;
  onConfirmer: () => void;
  onAnnuler: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialogue = ref.current;
    if (!dialogue) return;
    if (ouverte && !dialogue.open) dialogue.showModal();
    if (!ouverte && dialogue.open) dialogue.close();
  }, [ouverte]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="modale-titre"
      onCancel={(e) => {
        e.preventDefault();
        onAnnuler();
      }}
      className="m-auto max-w-lg rounded-lg bg-blanc p-6 text-nuit backdrop:bg-nuit/60"
    >
      <h2 id="modale-titre" className="m-0 mb-3 font-display text-h3 font-semibold">
        {titre}
      </h2>
      <div className="grid gap-2">{children}</div>
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" disabled={enCours} onClick={onAnnuler}>
          Annuler
        </Button>
        <Button type="button" variant="alerte" disabled={enCours} onClick={onConfirmer}>
          {libelleConfirmer}
        </Button>
      </div>
    </dialog>
  );
}

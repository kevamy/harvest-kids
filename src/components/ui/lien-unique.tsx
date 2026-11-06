"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "./button";

/**
 * One-time account link (ADR 0014): shown once, to be sent by the administrator (WhatsApp,
 * SMS). It is never shown again: closing this box loses it, a new link must then be issued.
 */
export function LienUnique({
  titre,
  lien,
  validite,
  onFermer,
}: {
  titre: string;
  lien: string;
  /** "7 jours", "24 heures". */
  validite: string;
  onFermer: () => void;
}) {
  const [copie, setCopie] = useState<"ok" | "echec" | null>(null);
  return (
    <section
      aria-labelledby="lien-unique-titre"
      className="grid gap-3 rounded-md bg-bleu-voile px-5 py-4 text-nuit"
    >
      <h2 id="lien-unique-titre" className="m-0 font-display text-h3 font-semibold">
        {titre}
      </h2>
      <p className="m-0">
        Envoyez ce lien à la personne (WhatsApp, SMS). Il est valable {validite} et ne sert
        qu&apos;une fois. <strong>Il ne sera plus affiché</strong> : copiez-le maintenant.
      </p>
      <label htmlFor="lien-unique" className="text-label font-bold">
        Lien à transmettre
      </label>
      <input
        id="lien-unique"
        readOnly
        value={lien}
        onFocus={(e) => e.currentTarget.select()}
        className="min-h-touch rounded-md bg-blanc px-4 font-mono text-label shadow-[inset_0_0_0_2px_var(--color-ligne)]"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="bleu"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(lien);
              setCopie("ok");
            } catch {
              setCopie("echec");
            }
          }}
        >
          <Copy aria-hidden />
          Copier le lien
        </Button>
        <Button type="button" variant="ghost" onClick={onFermer}>
          J&apos;ai transmis le lien
        </Button>
        {copie ? (
          <p role="status" className="m-0 font-bold">
            {copie === "ok"
              ? "Lien copié."
              : "La copie a échoué : sélectionnez le lien et copiez-le à la main."}
          </p>
        ) : null}
      </div>
    </section>
  );
}

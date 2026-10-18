"use client";

import { ScanLine } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Scan entry point. USB/Bluetooth scanners type like a keyboard and end with
 * Enter, so a focused text field captures them; the same field accepts a
 * typed code. Camera scanning (@zxing/browser) is added in lot 1.
 */
export function Scanner({
  onScan,
  libelle = "Scannez la carte famille ou saisissez le code",
  className,
}: {
  onScan: (valeur: string) => void;
  libelle?: string;
  className?: string;
}) {
  const id = useId();
  const champ = useRef<HTMLInputElement>(null);
  const [valeur, setValeur] = useState("");

  return (
    <form
      className={cn("grid gap-2", className)}
      onSubmit={(event) => {
        event.preventDefault();
        const lu = valeur.trim();
        if (lu) onScan(lu);
        setValeur("");
        champ.current?.focus();
      }}
    >
      <label htmlFor={id} className="text-label font-bold">
        {libelle}
      </label>
      <div className="flex items-center gap-3 rounded-pill bg-blanc pr-2 pl-5 shadow-card focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-nuit">
        <ScanLine aria-hidden className="size-6 shrink-0 text-bleu" />
        <input
          ref={champ}
          id={id}
          value={valeur}
          onChange={(event) => setValeur(event.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          className="min-h-touch w-full bg-transparent text-body-lg outline-none focus-visible:outline-none"
        />
      </div>
    </form>
  );
}

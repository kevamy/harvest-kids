"use client";

import { useState } from "react";
import { normaliserTelephone } from "@/lib/telephone";
import { Button } from "./button";
import { Champ } from "./champ";

/**
 * Phone field. Checked when the field is left, with the church's default country code:
 * an invalid number is reported, and a Beninese number in the former 8-digit plan gets a
 * proposal to confirm ("Voulez-vous dire 01 … ?"). The server normalises again and never
 * stores a number that needs confirmation.
 */
export function ChampTelephone({
  id,
  libelle,
  aide,
  value,
  onChange,
  indicatif,
}: {
  id: string;
  libelle: string;
  aide?: string;
  value: string;
  onChange: (valeur: string) => void;
  indicatif: string;
}) {
  const [verification, setVerification] = useState<ReturnType<typeof normaliserTelephone> | null>(
    null,
  );
  const verifier = () =>
    setVerification(value.trim() ? normaliserTelephone(value, indicatif) : null);

  return (
    <div className="grid gap-2">
      <Champ
        id={id}
        libelle={libelle}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        aide={verification?.statut === "invalide" ? undefined : aide}
        erreur={verification?.statut === "invalide" ? verification.message : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setVerification(null);
        }}
        onBlur={verifier}
      />
      {verification?.statut === "a_confirmer" ? (
        <div role="alert" className="grid gap-2 rounded-md bg-soleil px-5 py-3 text-nuit">
          <p className="m-0 font-bold">{verification.message}</p>
          <Button
            type="button"
            variant="sombre"
            className="justify-self-start"
            onClick={() => {
              onChange(verification.proposition);
              setVerification(null);
            }}
          >
            Oui, utiliser le {verification.proposition}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

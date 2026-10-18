import * as React from "react";
import { cn } from "@/lib/utils";

/** Labelled text field: 56 px touch target, error read out with the field. */
export function Champ({
  id,
  libelle,
  erreur,
  aide,
  className,
  ...props
}: React.ComponentProps<"input"> & {
  id: string;
  libelle: string;
  erreur?: string;
  aide?: string;
}) {
  const idMessage = erreur ? `${id}-erreur` : aide ? `${id}-aide` : undefined;
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-label font-bold">
        {libelle}
      </label>
      <input
        id={id}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={idMessage}
        className={cn(
          "min-h-touch w-full rounded-md bg-blanc px-5 text-body-lg text-nuit shadow-[inset_0_0_0_2px_var(--color-ligne)] outline-none focus-visible:shadow-[inset_0_0_0_3px_var(--color-nuit)]",
          erreur && "shadow-[inset_0_0_0_2px_var(--color-alerte)]",
          className,
        )}
        {...props}
      />
      {erreur ? (
        <p id={idMessage} className="text-label font-bold text-alerte">
          {erreur}
        </p>
      ) : aide ? (
        <p id={idMessage} className="text-label text-texte-doux">
          {aide}
        </p>
      ) : null}
    </div>
  );
}

/** Blocking message: says what is wrong and what to do (design/charte.md). */
export function MessageErreur({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-md bg-rose-voile px-5 py-4 font-bold text-alerte">
      {children}
    </p>
  );
}

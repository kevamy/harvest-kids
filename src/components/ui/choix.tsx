import * as React from "react";
import { cn } from "@/lib/utils";

/** Group of radio cards with a visible legend (one choice among a few). */
export function GroupeChoix({
  legende,
  aide,
  children,
  className,
}: {
  legende: string;
  aide?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("m-0 grid gap-3 border-0 p-0", className)}>
      <legend className="mb-1 p-0 text-label font-bold">{legende}</legend>
      {aide ? <p className="m-0 text-label text-texte-doux">{aide}</p> : null}
      {children}
    </fieldset>
  );
}

/**
 * One radio card: the whole card is the touch target (56 px minimum), the native
 * radio stays for keyboard and screen readers.
 */
export function OptionChoix({
  titre,
  description,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & {
  titre: string;
  description?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex min-h-touch cursor-pointer items-start gap-4 rounded-md bg-blanc px-5 py-4 shadow-[inset_0_0_0_2px_var(--color-ligne)] has-checked:shadow-[inset_0_0_0_3px_var(--color-bleu)] has-focus-visible:outline-3 has-focus-visible:outline-offset-3 has-focus-visible:outline-nuit",
        className,
      )}
    >
      <input type="radio" className="mt-1 size-5 shrink-0 accent-bleu" {...props} />
      <span className="grid gap-1">
        <span className="font-bold">{titre}</span>
        {description ? <span className="text-label text-texte-doux">{description}</span> : null}
      </span>
    </label>
  );
}

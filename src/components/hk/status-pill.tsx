import { cn } from "@/lib/utils";
import { APPARENCE_STATUT, type StatutAffiche } from "@/lib/statuts";

const base =
  "inline-flex items-center gap-2 rounded-pill px-3.5 py-1.5 font-sans text-label font-bold whitespace-nowrap";

/** Status of a child: the coloured dot and the label always go together. */
export function StatusPill({ statut, className }: { statut: StatutAffiche; className?: string }) {
  const { libelle, classes } = APPARENCE_STATUT[statut];
  return (
    <span data-statut={statut} className={cn(base, classes, className)}>
      <span aria-hidden className="size-2 rounded-full bg-current" />
      {libelle}
    </span>
  );
}

/** Neutral label (age range, room…) on a coloured card. */
export function Pastille({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(base, "bg-transparent ring-[1.5px] ring-current ring-inset", className)}>
      {children}
    </span>
  );
}

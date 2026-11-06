import { cn } from "@/lib/utils";

const TAILLES = {
  /** In a list, next to the first name: one family per line, read up close. */
  sm: "text-[20px]/6 tracking-[0.5px]",
  md: "text-h2",
  lg: "text-matricule",
  ecran: "text-[clamp(56px,7vw,128px)] leading-none",
} as const;

/**
 * The matricule is the shared landmark: always in Fredoka, readable from afar ("lg" for a
 * scan result, a family record or a card; "ecran" for the call screen). "sm" is for lists.
 */
export function MatriculeBadge({
  matricule,
  taille = "lg",
  className,
}: {
  matricule: string;
  taille?: keyof typeof TAILLES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-display font-semibold tracking-[1px] whitespace-nowrap tabular-nums",
        TAILLES[taille],
        className,
      )}
    >
      {matricule}
    </span>
  );
}

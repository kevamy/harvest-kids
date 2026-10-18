import { cn } from "@/lib/utils";

const COULEURS = {
  nuit: "bg-nuit text-blanc",
  rose: "bg-rose text-nuit",
  bleu: "bg-bleu-layette text-nuit",
  soleil: "bg-soleil text-nuit",
  blanc: "bg-blanc text-nuit shadow-card",
} as const;

type Sol = "creme" | "blanc" | "nuit" | "bleu-voile" | "rose-voile";

/**
 * Signature card: large radius, top-right corner cut out in the colour of the
 * ground it sits on (design/composant-NotchCard.md). One card, one subject.
 */
export function NotchCard({
  couleur = "blanc",
  sol = "creme",
  coin,
  as: Tag = "section",
  className,
  style,
  children,
  ...props
}: {
  couleur?: keyof typeof COULEURS;
  /** Colour of the surface the card is placed on (fills the notch). */
  sol?: Sol;
  /** Icon or badge placed inside the notch. */
  coin?: React.ReactNode;
  as?: "section" | "article" | "div";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={cn("hk-notch", COULEURS[couleur], className)}
      style={{ ...style, ["--ground" as string]: `var(--color-${sol})` }}
      {...props}
    >
      <div>{children}</div>
      {coin ? <div className="hk-notch__corner">{coin}</div> : null}
    </Tag>
  );
}

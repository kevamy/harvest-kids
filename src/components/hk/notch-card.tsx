import { cn } from "@/lib/utils";

const COULEURS = {
  nuit: "bg-nuit text-blanc",
  rose: "bg-rose text-nuit",
  bleu: "bg-bleu-layette text-nuit",
  soleil: "bg-soleil text-nuit",
  blanc: "bg-blanc text-nuit shadow-card",
} as const;

type Sol = "creme" | "blanc" | "nuit" | "bleu-voile" | "rose-voile";

/*
 * Only the title leaves room for the notch, not the whole content. design/tokens.css gives
 * that room to the card's first child, in the components layer, where a utility such as
 * `m-0` on that child cancels it: the rule is restated here, among the utilities. When the
 * content is wrapped (`<div className="grid">`, `<section>`, `<form>`), the title is that
 * wrapper's first child, one or two levels down: the room goes to it and the wrapper keeps the
 * full width. A title is a heading (h1 to h6) or a `<header>`; a title row with something on
 * its right (a status pill) is a `<header>`. A card with no title keeps the room on its first
 * child, so nothing runs under the notch.
 */
const TITRE_SOUS_ENCOCHE = [
  "[&>:first-child]:mr-[calc(var(--notch-w)_-_16px)]",
  // Title at the second level: the room, taken from the wrapper.
  "[&>:first-child:not(:is(h1,h2,h3,h4,h5,h6,header))>:is(h1,h2,h3,h4,h5,h6,header):first-child]:mr-[calc(var(--notch-w)_-_16px)]",
  "[&:has(>:first-child:not(:is(h1,h2,h3,h4,h5,h6,header))>:is(h1,h2,h3,h4,h5,h6,header):first-child)>:first-child]:mr-0",
  // Title at the third level.
  "[&>:first-child:not(:is(h1,h2,h3,h4,h5,h6,header))>:first-child:not(:is(h1,h2,h3,h4,h5,h6,header))>:is(h1,h2,h3,h4,h5,h6,header):first-child]:mr-[calc(var(--notch-w)_-_16px)]",
  "[&:has(>:first-child:not(:is(h1,h2,h3,h4,h5,h6,header))>:first-child:not(:is(h1,h2,h3,h4,h5,h6,header))>:is(h1,h2,h3,h4,h5,h6,header):first-child)>:first-child]:mr-0",
].join(" ");

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
      className={cn("hk-notch", TITRE_SOUS_ENCOCHE, COULEURS[couleur], className)}
      style={{ ...style, ["--ground" as string]: `var(--color-${sol})` }}
      {...props}
    >
      {children}
      {coin ? <div className="hk-notch__corner">{coin}</div> : null}
    </Tag>
  );
}

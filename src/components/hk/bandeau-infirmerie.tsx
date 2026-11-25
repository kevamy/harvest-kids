import { TriangleAlert } from "lucide-react";

/**
 * A child at the infirmerie, announced first and in red wherever the child appears (RG-07,
 * lot 3): check-out at the reception desk and at the class door, class list, child's card.
 * Always a sentence, never a colour alone (design/composant-StatusPill.md).
 */
export function BandeauInfirmerie({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="m-0 flex gap-2 rounded-md bg-alerte px-4 py-3 font-bold text-blanc">
      <TriangleAlert aria-hidden className="size-6 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** "Ayo est à l'infirmerie depuis 4 min." or "Ayo est en route vers l'infirmerie (2 min)." */
export function phraseInfirmerie(prenom: string, minutes: number, enRoute: boolean): string {
  return enRoute
    ? `${prenom} est en route vers l'infirmerie (${minutes} min).`
    : `${prenom} est à l'infirmerie depuis ${minutes} min.`;
}

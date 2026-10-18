import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { MatriculeBadge } from "./matricule-badge";

export type TuileAppel = {
  matricule: string;
  /** appel = parent expected at reception, infirmerie, pret = ready for pick-up. */
  type: "appel" | "infirmerie" | "pret";
  lieu: string;
};

const TUILES = {
  appel: { classes: "bg-soleil text-nuit", libelle: "Parent attendu" },
  infirmerie: { classes: "bg-alerte text-blanc", libelle: "Infirmerie" },
  pret: { classes: "bg-bleu-layette text-nuit", libelle: "Prêt au retrait" },
} as const;

/**
 * Call screen projected in the worship hall (RG-10): matricules and meeting
 * places only, never a name or a photo.
 */
export function CallBoard({
  tuiles,
  titre = "Parents attendus",
  consigne = "Présentez-vous au lieu indiqué avec votre carte famille.",
  logo,
  horsLigne = false,
  pleinEcran = false,
  className,
}: {
  tuiles: readonly TuileAppel[];
  titre?: string;
  consigne?: string;
  /** Light variant of the church logo. */
  logo?: React.ReactNode;
  horsLigne?: boolean;
  pleinEcran?: boolean;
  className?: string;
}) {
  return (
    <section
      data-slot="call-board"
      className={cn(
        "grid content-start gap-6 bg-nuit p-8 text-blanc",
        pleinEcran ? "min-h-dvh" : "rounded-lg",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-4">
        <div>
          <h2 className={cn("m-0 font-display font-semibold", pleinEcran ? "text-h1" : "text-h2")}>
            {titre}
          </h2>
          <p className="mt-1 text-body font-semibold text-nuit-doux">{consigne}</p>
        </div>
        <div className="flex items-center gap-4">
          {horsLigne ? (
            <span
              role="status"
              className="inline-flex items-center gap-2 text-label text-nuit-doux"
            >
              <WifiOff aria-hidden className="size-4" />
              Connexion perdue
            </span>
          ) : null}
          {logo}
        </div>
      </header>

      {tuiles.length === 0 ? (
        <p className="text-body-lg text-nuit-doux">Aucun appel en cours.</p>
      ) : (
        <ul
          className={cn(
            "grid gap-4",
            pleinEcran
              ? "grid-cols-[repeat(auto-fill,minmax(320px,1fr))]"
              : "grid-cols-[repeat(auto-fill,minmax(190px,1fr))]",
          )}
        >
          {tuiles.map((tuile) => {
            const apparence = TUILES[tuile.type];
            return (
              <li
                key={tuile.matricule}
                data-type={tuile.type}
                className={cn("grid gap-1 rounded-md p-4", apparence.classes)}
              >
                <MatriculeBadge matricule={tuile.matricule} taille={pleinEcran ? "ecran" : "lg"} />
                <span className="text-label font-bold">
                  {tuile.lieu === apparence.libelle
                    ? apparence.libelle
                    : `${apparence.libelle} · ${tuile.lieu}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

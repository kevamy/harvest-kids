import Image from "next/image";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { initiales, teinteInitiales } from "@/lib/initiales";
import type { StatutAffiche } from "@/lib/statuts";
import { MatriculeBadge } from "./matricule-badge";
import { StatusPill } from "./status-pill";

export type ChildCardProps = {
  prenom: string;
  nom: string;
  /** Already formatted, e.g. "4 ans". */
  age: string;
  classe: string;
  matricule: string;
  statut: StatutAffiche;
  alertes?: readonly string[];
  /** Authenticated photo route (RG-11); initials are shown when absent. */
  photoUrl?: string | null;
  /** Position in the list, drives the alternating colour of the initials. */
  index?: number;
  className?: string;
};

/** Compact child card: photo, name, age and class, medical flags, matricule, status. */
export function ChildCard({
  prenom,
  nom,
  age,
  classe,
  matricule,
  statut,
  alertes = [],
  photoUrl,
  index = 0,
  className,
}: ChildCardProps) {
  const teinte = teinteInitiales(index) === "bleu" ? "bg-bleu-layette" : "bg-rose";
  return (
    <article
      data-statut={statut}
      className={cn(
        "grid grid-cols-[88px_1fr_auto] items-center gap-4 rounded-lg bg-blanc py-4 pr-6 pl-4 shadow-card",
        statut === "INFIRMERIE" && "ring-[3px] ring-alerte",
        className,
      )}
    >
      {photoUrl ? (
        <Image
          src={photoUrl}
          alt={`Photo de ${prenom} ${nom}`}
          width={88}
          height={88}
          // Photos come from an authenticated route: the optimizer would fetch them without cookies.
          unoptimized
          className="size-22 rounded-md object-cover"
        />
      ) : (
        <div
          aria-hidden
          className={cn(
            "grid size-22 place-items-center rounded-md font-display text-[30px] leading-none font-semibold text-nuit",
            teinte,
          )}
        >
          {initiales(prenom, nom)}
        </div>
      )}

      <div className="min-w-0">
        <h3 className="m-0 font-display text-h3 font-semibold">
          {prenom} {nom}
        </h3>
        <div className="mt-1.5 flex flex-wrap gap-2 text-label font-semibold text-texte-doux">
          <span>{age}</span>
          <span aria-hidden>·</span>
          <span>{classe}</span>
        </div>
        {alertes.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Alertes médicales">
            {alertes.map((alerte) => (
              <li
                key={alerte}
                className="inline-flex items-center gap-1 rounded-pill bg-rose-voile px-2.5 py-0.5 text-caption font-extrabold text-rose-fonce"
              >
                <TriangleAlert aria-hidden className="size-3.5" />
                {alerte}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="grid justify-items-end gap-2">
        <MatriculeBadge matricule={matricule} taille="md" />
        <StatusPill statut={statut} />
      </div>
    </article>
  );
}

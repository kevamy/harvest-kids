"use client";

import { DoorOpen, OctagonAlert, TriangleAlert } from "lucide-react";
import type { AlertesDirect } from "@/app/api/direct/alertes/route";
import { useLiveQuery } from "@/lib/live-query";
import { cn } from "@/lib/utils";
import type { AlerteNonArrive } from "@/server/salle";

const enAttente = (a: AlerteNonArrive) =>
  `${a.prenom} (${a.matricule}) pas encore en salle · ${a.classe} · depuis ${a.minutes} min`;

/**
 * Live alerts (cahier §7.2.5, §7.4): a class with no monitor left gets the highest alert, a
 * class under its minimum a red one; a child still not in class after the church's delay is
 * named, with its class. Nothing is shown when there is no alert.
 * Compact: one band of pills, next to the reception desk's tabs.
 */
export function AlertesClasses({
  compact = false,
  className,
}: {
  compact?: boolean;
  /** Placement of the compact band in its row. */
  className?: string;
}) {
  const alertes = useLiveQuery<AlertesDirect>(["alertes-classes"], "/api/direct/alertes");
  const classes = alertes.data?.classes ?? [];
  const nonArrives = alertes.data?.nonArrives ?? [];
  if (classes.length === 0 && nonArrives.length === 0) return null;

  if (compact) {
    return (
      <div className={cn("flex flex-wrap gap-2", className)}>
        {classes.length > 0 ? (
          <section aria-label="Alertes des classes">
            <ul role="alert" className="m-0 flex list-none flex-wrap gap-2 p-0">
              {classes.map((a) => (
                <li
                  key={`${a.sessionId}-${a.classe}`}
                  className={
                    a.niveau === "sans_moniteur"
                      ? "flex items-center gap-2 rounded-pill bg-alerte px-4 py-2 font-bold text-blanc"
                      : "flex items-center gap-2 rounded-pill bg-rose-voile px-4 py-2 font-bold text-alerte"
                  }
                >
                  {a.niveau === "sans_moniteur" ? (
                    <>
                      <OctagonAlert aria-hidden className="size-5 shrink-0" />
                      Aucun moniteur dans {a.classe}
                    </>
                  ) : (
                    <>
                      <TriangleAlert aria-hidden className="size-5 shrink-0" />
                      {a.classe} : {a.moniteurs}/{a.minMoniteurs} moniteurs
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {nonArrives.length > 0 ? (
          <section aria-label="Enfants pas encore en salle">
            <ul role="alert" className="m-0 flex list-none flex-wrap gap-2 p-0">
              {nonArrives.map((a) => (
                <li
                  key={a.presenceId}
                  className="flex items-center gap-2 rounded-pill bg-soleil px-4 py-2 font-bold text-nuit"
                >
                  <DoorOpen aria-hidden className="size-5 shrink-0" />
                  {enAttente(a)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("grid gap-3", className)}>
      {classes.length > 0 ? (
        <section aria-label="Alertes des classes" className="grid gap-3">
          <ul role="alert" className="m-0 grid list-none gap-3 p-0">
            {classes.map((a) =>
              a.niveau === "sans_moniteur" ? (
                <li
                  key={`${a.sessionId}-${a.classe}`}
                  className="flex items-center gap-3 rounded-md bg-alerte px-5 py-4 font-display text-h3 font-semibold text-blanc"
                >
                  <OctagonAlert aria-hidden className="size-7 shrink-0" />
                  Aucun moniteur dans {a.classe}
                </li>
              ) : (
                <li
                  key={`${a.sessionId}-${a.classe}`}
                  className="flex items-center gap-3 rounded-md bg-rose-voile px-5 py-3 font-bold text-alerte"
                >
                  <TriangleAlert aria-hidden className="size-6 shrink-0" />
                  {a.classe} : {a.moniteurs}/{a.minMoniteurs} moniteurs
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}
      {nonArrives.length > 0 ? (
        <section aria-label="Enfants pas encore en salle" className="grid gap-3">
          <ul role="alert" className="m-0 grid list-none gap-3 p-0">
            {nonArrives.map((a) => (
              <li
                key={a.presenceId}
                className="flex items-center gap-3 rounded-md bg-soleil px-5 py-3 font-bold text-nuit"
              >
                <DoorOpen aria-hidden className="size-6 shrink-0" />
                {enAttente(a)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

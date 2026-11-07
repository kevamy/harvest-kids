"use client";

import { OctagonAlert, TriangleAlert } from "lucide-react";
import { useLiveQuery } from "@/lib/live-query";
import type { AlerteClasse } from "@/server/moniteurs-session";

/**
 * Live class alerts (cahier §7.2.5): a class with no monitor left gets the highest alert,
 * a class under its minimum a red one. Nothing is shown when every class is staffed.
 */
export function AlertesClasses() {
  const alertes = useLiveQuery<AlerteClasse[]>(["alertes-classes"], "/api/direct/alertes");
  if (!alertes.data || alertes.data.length === 0) return null;
  return (
    <section aria-label="Alertes des classes" className="grid gap-3">
      <ul role="alert" className="m-0 grid list-none gap-3 p-0">
        {alertes.data.map((a) =>
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
  );
}

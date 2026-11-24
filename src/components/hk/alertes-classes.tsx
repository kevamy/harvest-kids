"use client";

import { DoorOpen, HeartPulse, OctagonAlert, ShieldAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { AlertesDirect } from "@/app/api/direct/alertes/route";
import { INTERVALLE_URGENT_MS, useLiveQuery } from "@/lib/live-query";
import { cn } from "@/lib/utils";
import type { AlerteNonArrive } from "@/server/salle";

const enAttente = (a: AlerteNonArrive) =>
  a.retourInfirmerie
    ? `${a.prenom} (${a.matricule}) renvoyé de l'infirmerie, pas encore en salle · ${a.classe} · depuis ${a.minutes} min`
    : `${a.prenom} (${a.matricule}) pas encore en salle · ${a.classe} · depuis ${a.minutes} min`;

type AlerteInfirmerie = AlertesDirect["infirmerie"][number];

/** RG-07, lot 3: "not arrived" past the church's delay, otherwise where the child is. */
const aInfirmerie = (a: AlerteInfirmerie) =>
  a.nonArrive
    ? `${a.prenom} n'est pas arrivé à l'infirmerie · ${a.classe} · parti il y a ${a.depuisMinutes} min`
    : a.enRoute
      ? `${a.prenom} (${a.matricule}) en route vers l'infirmerie · ${a.classe} · depuis ${a.depuisMinutes} min`
      : `${a.prenom} (${a.matricule}) à l'infirmerie · ${a.classe} · depuis ${a.depuisMinutes} min`;

/** Children at the infirmerie, each opening their card; red when not arrived. */
function Infirmerie({ alertes, compact }: { alertes: AlerteInfirmerie[]; compact: boolean }) {
  if (alertes.length === 0) return null;
  return (
    <section aria-label="Enfants à l'infirmerie" className={compact ? undefined : "grid gap-3"}>
      <ul
        role="alert"
        className={cn("m-0 list-none gap-2 p-0", compact ? "flex flex-wrap" : "grid gap-3")}
      >
        {alertes.map((a) => (
          <li
            key={a.presenceId}
            className={cn(
              "flex items-center gap-2 font-bold",
              compact ? "rounded-pill px-4 py-2" : "rounded-md px-5 py-3",
              a.nonArrive ? "bg-alerte text-blanc" : "bg-rose-voile text-alerte",
            )}
          >
            <HeartPulse aria-hidden className="size-5 shrink-0" />
            <Link href={`/presences/${a.presenceId}`} className="text-inherit">
              {aInfirmerie(a)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

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
  const alertes = useLiveQuery<AlertesDirect>(["alertes-classes"], "/api/direct/alertes", {
    intervalleMs: INTERVALLE_URGENT_MS,
  });
  const classes = alertes.data?.classes ?? [];
  const nonArrives = alertes.data?.nonArrives ?? [];
  const bloquees = alertes.data?.tablettesBloquees ?? [];
  const sessionsBloquees = alertes.data?.sessionsCodesBloques ?? [];
  const infirmerie = alertes.data?.infirmerie ?? [];
  if (
    infirmerie.length === 0 &&
    classes.length === 0 &&
    nonArrives.length === 0 &&
    bloquees.length === 0 &&
    sessionsBloquees.length === 0
  ) {
    return null;
  }

  // Wrong retrieval codes: someone may be trying codes at the desk (cahier §7.6, ADR 0016).
  const tablettes =
    bloquees.length > 0 || sessionsBloquees.length > 0 ? (
      <section aria-label="Codes de retrait bloqués">
        <ul role="alert" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {sessionsBloquees.map((s) => (
            <li
              key={s.sessionId}
              className="flex items-center gap-2 rounded-pill bg-alerte px-4 py-2 font-bold text-blanc"
            >
              <ShieldAlert aria-hidden className="size-5 shrink-0" />
              Codes de retrait bloqués sur toutes les tablettes jusqu&apos;à la fin de la session
              {s.culte ? ` (${s.culte})` : ""}, après 20 codes erronés : scannez les cartes et
              vérifiez qui se présente au retrait.
            </li>
          ))}
          {bloquees.map((t, i) => (
            <li
              key={`${t.sessionId}-${i}`}
              className="flex items-center gap-2 rounded-pill bg-alerte px-4 py-2 font-bold text-blanc"
            >
              <ShieldAlert aria-hidden className="size-5 shrink-0" />
              Tablette bloquée après 5 codes de retrait erronés (encore {t.minutes} min) : vérifiez
              qui se présente au retrait.
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  if (compact) {
    return (
      <div className={cn("flex flex-wrap gap-2", className)}>
        <Infirmerie alertes={infirmerie} compact />
        {tablettes}
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
      <Infirmerie alertes={infirmerie} compact={false} />
      {tablettes}
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

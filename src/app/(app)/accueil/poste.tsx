"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkin, type SessionOuverte } from "./checkin";
import { Checkout } from "./checkout";

type Onglet = "checkin" | "checkout";

const LIBELLES: Record<Onglet, string> = { checkin: "Check-in", checkout: "Check-out" };

/**
 * The reception desk (cahier §7.3, §7.6): a check-in tab and a check-out tab, each shown
 * only with its right. Both panels stay mounted: a check-in in progress survives a look at
 * the check-out. Tabs follow the ARIA pattern (arrow keys move between them). In landscape,
 * the tabs share their line with the alerts band.
 */
export function PosteAccueil({
  sessions,
  checkin,
  checkout,
  alertes,
}: {
  sessions: SessionOuverte[];
  checkin: boolean;
  checkout: boolean;
  alertes: React.ReactNode;
}) {
  const onglets = (["checkin", "checkout"] as const).filter((o) =>
    o === "checkin" ? checkin : checkout,
  );
  const [actif, setActif] = useState<Onglet>(onglets[0] ?? "checkin");
  const boutons = useRef<Partial<Record<Onglet, HTMLButtonElement | null>>>({});

  const deplacer = (sens: 1 | -1) => {
    const suivant = onglets[(onglets.indexOf(actif) + sens + onglets.length) % onglets.length]!;
    setActif(suivant);
    boutons.current[suivant]?.focus();
  };

  return (
    <div className="grid gap-4">
      {/* Landscape: the tabs and the alerts band share one line. */}
      <div className="flex flex-col gap-4 md:landscape:flex-row md:landscape:items-center">
        <div
          role="tablist"
          aria-label="Poste d'accueil"
          className="flex shrink-0 flex-wrap items-center gap-2"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") deplacer(1);
            if (e.key === "ArrowLeft") deplacer(-1);
          }}
        >
          {onglets.map((o) => (
            <Button
              key={o}
              ref={(el) => {
                boutons.current[o] = el;
              }}
              type="button"
              role="tab"
              id={`onglet-${o}`}
              aria-selected={actif === o}
              aria-controls={`panneau-${o}`}
              tabIndex={actif === o ? 0 : -1}
              variant={actif === o ? "sombre" : "ghost"}
              onClick={() => setActif(o)}
            >
              {LIBELLES[o]}
            </Button>
          ))}
        </div>
        {alertes}
      </div>
      {checkin ? (
        <div
          role="tabpanel"
          id="panneau-checkin"
          aria-labelledby="onglet-checkin"
          hidden={actif !== "checkin"}
        >
          <Checkin sessions={sessions} actif={actif === "checkin"} />
        </div>
      ) : null}
      {checkout ? (
        <div
          role="tabpanel"
          id="panneau-checkout"
          aria-labelledby="onglet-checkout"
          hidden={actif !== "checkout"}
        >
          <Checkout sessions={sessions} actif={actif === "checkout"} />
        </div>
      ) : null}
    </div>
  );
}

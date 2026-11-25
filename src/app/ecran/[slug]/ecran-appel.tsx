"use client";

import { useEffect, useRef, useState } from "react";
import type { EcranDirect } from "@/app/api/ecran/[slug]/route";
import { CallBoard } from "@/components/hk/call-board";
import { ErreurDirect, INTERVALLE_URGENT_MS, useLiveQuery } from "@/lib/live-query";

const MESSAGES: Record<number, string> = {
  401: "Cet écran n'est pas encore appairé : ouvrez sur cet appareil le lien donné par l'administrateur de l'église.",
  404: "Cet écran n'est pas appairé à cette église : ouvrez sur cet appareil le lien donné par l'administrateur.",
  410: "Cet écran a été retiré : demandez un nouveau lien à l'administrateur.",
};

/**
 * The call screen's device side. A pairing link (`#HKE1.…`) is posted once, then removed from
 * the address bar; afterwards the screen polls its tiles every 3 s and says when the
 * connection is lost. A new tile stands out a few seconds (CallBoard), without sound.
 */
export function EcranAppel({ slug }: { slug: string }) {
  // Without a pairing link in the address, the device is already paired (or not at all):
  // the tiles are polled at once. Either way, the first render shows the same loading screen.
  const [pret, setPret] = useState(
    () => typeof window !== "undefined" && window.location.hash.length <= 1,
  );
  const [erreurAppairage, setErreurAppairage] = useState<string | null>(null);
  const envoye = useRef(false);

  useEffect(() => {
    if (envoye.current) return;
    envoye.current = true;
    const jeton = window.location.hash.slice(1);
    if (!jeton) return;
    // The token leaves the address bar (history, screenshots) before anything else.
    window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      try {
        const reponse = await fetch(`/api/ecran/${encodeURIComponent(slug)}/appairage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jeton }),
          cache: "no-store",
        });
        if (!reponse.ok) {
          const corps = (await reponse.json().catch(() => null)) as { message?: string } | null;
          setErreurAppairage(corps?.message ?? "L'appairage a échoué. Rouvrez le lien.");
          return;
        }
        setPret(true);
      } catch {
        setErreurAppairage(
          "Le serveur ne répond pas. Vérifiez la connexion, puis rouvrez le lien.",
        );
      }
    })();
  }, [slug]);

  const direct = useLiveQuery<EcranDirect>(["ecran", slug], `/api/ecran/${slug}`, {
    intervalleMs: INTERVALLE_URGENT_MS,
    actif: pret,
  });

  const statut = direct.error instanceof ErreurDirect ? direct.error.statut : null;
  const blocage = erreurAppairage ?? (statut !== null ? MESSAGES[statut] : undefined);
  if (blocage && !direct.data) {
    return (
      <section
        aria-label="Écran d'appel"
        className="grid min-h-dvh place-content-center gap-4 bg-nuit p-8 text-blanc"
      >
        <h1 className="m-0 font-display text-h1 font-semibold">Écran d&apos;appel</h1>
        <p role="alert" className="m-0 max-w-2xl text-body-lg">
          {blocage}
        </p>
      </section>
    );
  }
  if (!direct.data) {
    return (
      <section aria-label="Écran d'appel" className="grid min-h-dvh place-content-center bg-nuit">
        <p className="m-0 text-body-lg text-nuit-doux">Chargement de l&apos;écran d&apos;appel…</p>
      </section>
    );
  }

  const { eglise, tuiles } = direct.data;
  // Revoked while showing: the screen says so instead of keeping stale tiles.
  if (statut === 410) {
    return (
      <section
        aria-label="Écran d'appel"
        className="grid min-h-dvh place-content-center gap-4 bg-nuit p-8 text-blanc"
      >
        <p role="alert" className="m-0 max-w-2xl text-body-lg">
          {MESSAGES[410]}
        </p>
      </section>
    );
  }
  return (
    <div aria-label="Écran d'appel" role="region">
      <CallBoard
        tuiles={tuiles}
        pleinEcran
        horsLigne={direct.isError}
        logo={
          eglise.logo ? (
            // The authenticated logo route of the screen: not for the image optimizer.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/ecran/${slug}/logo`}
              alt={`Logo de ${eglise.nom}`}
              className="h-16 w-auto"
            />
          ) : (
            <span className="font-display text-h2 font-semibold">{eglise.nom}</span>
          )
        }
      />
    </div>
  );
}

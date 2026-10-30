"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { NotchCard } from "@/components/hk/notch-card";
import { Button } from "@/components/ui/button";
import { Champ, MessageErreur } from "@/components/ui/champ";
import { deverrouiller, seDeconnecter } from "@/app/actions/session";
import { DELAI_VERROUILLAGE_MS, INTERVALLE_ENREGISTREMENT_MS } from "@/lib/activite";
import { schemaDeverrouillage } from "@/lib/schemas/auth";
import { usePret } from "@/lib/use-pret";

/** Lock screen shown instead of the page when the tablet has been idle for 15 minutes. */
export function EcranVerrouille({ nom }: { nom: string }) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [bloque, setBloque] = useState(false);
  const formulaire = useForm<z.infer<typeof schemaDeverrouillage>>({
    resolver: zodResolver(schemaDeverrouillage),
    defaultValues: { pin: "" },
  });
  const { errors, isSubmitting } = formulaire.formState;
  const pret = usePret();

  return (
    <main className="grid min-h-dvh place-items-center bg-nuit p-6">
      <NotchCard
        couleur="blanc"
        sol="nuit"
        className="w-full max-w-md"
        coin={<Lock aria-hidden className="size-7 text-blanc" />}
      >
        <h1 className="m-0 font-display text-h2 font-semibold">Tablette verrouillée</h1>
        <p className="mt-2 text-texte-doux">
          {nom}, saisissez votre code PIN pour reprendre là où vous en étiez.
        </p>
        <form
          method="post"
          noValidate
          className="mt-6 grid gap-5"
          onSubmit={formulaire.handleSubmit(async (valeurs) => {
            setErreur(null);
            try {
              const resultat = await deverrouiller(valeurs);
              if (resultat.ok) {
                router.refresh();
                return;
              }
              setErreur(resultat.erreur);
              setBloque(resultat.bloque === true);
              formulaire.reset();
            } catch {
              setErreur(
                "Le serveur ne répond pas. Vérifiez le Wi-Fi ou la 4G de la tablette, puis réessayez.",
              );
            }
          })}
        >
          {erreur ? <MessageErreur>{erreur}</MessageErreur> : null}
          {!bloque ? (
            <>
              <Champ
                id="pin"
                libelle="Code PIN"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                autoFocus
                erreur={errors.pin?.message}
                {...formulaire.register("pin")}
              />
              <Button type="submit" variant="bleu" size="xl" disabled={!pret || isSubmitting}>
                Déverrouiller
              </Button>
            </>
          ) : null}
        </form>
        <form action={seDeconnecter} className="mt-4">
          <Button type="submit" variant="ghost" className="w-full">
            Se reconnecter avec mon mot de passe
          </Button>
        </form>
      </NotchCard>
    </main>
  );
}

/**
 * Reports real user activity (touch, keyboard) at most once per minute, and
 * reloads the page once 15 minutes pass without any: the server then shows the
 * lock screen. Automatic refreshes never count as activity.
 */
export function SuiviActivite() {
  const router = useRouter();
  const derniereInteraction = useRef(0);
  const dernierEnvoi = useRef(0);

  useEffect(() => {
    const maintenant = Date.now();
    derniereInteraction.current = maintenant;
    dernierEnvoi.current = maintenant;

    const surInteraction = () => {
      const t = Date.now();
      derniereInteraction.current = t;
      if (t - dernierEnvoi.current >= INTERVALLE_ENREGISTREMENT_MS) {
        dernierEnvoi.current = t;
        void fetch("/api/session/activite", { method: "POST" }).catch(() => undefined);
      }
    };
    const evenements = ["pointerdown", "keydown"] as const;
    for (const e of evenements) window.addEventListener(e, surInteraction, { passive: true });

    const minuteur = window.setInterval(() => {
      if (Date.now() - derniereInteraction.current >= DELAI_VERROUILLAGE_MS) {
        derniereInteraction.current = Date.now();
        router.refresh();
      }
    }, 30_000);

    return () => {
      for (const e of evenements) window.removeEventListener(e, surInteraction);
      window.clearInterval(minuteur);
    };
  }, [router]);

  return null;
}

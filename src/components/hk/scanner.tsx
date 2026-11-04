"use client";

import { Camera, CameraOff, ScanLine } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Scan entry point. USB/Bluetooth scanners type like a keyboard and end with
 * Enter, so a focused text field captures them; the same field accepts a
 * typed code. The tablet's camera reads QR codes too (@zxing/browser), on demand.
 */
export function Scanner({
  onScan,
  libelle = "Scannez la carte famille ou saisissez le code",
  avecCamera = false,
  className,
}: {
  onScan: (valeur: string) => void;
  libelle?: string;
  /** Offers to read the QR code with the tablet's camera. */
  avecCamera?: boolean;
  className?: string;
}) {
  const id = useId();
  const champ = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [valeur, setValeur] = useState("");
  const [camera, setCamera] = useState(false);
  const [erreurCamera, setErreurCamera] = useState<string | null>(null);
  const rappel = useRef(onScan);
  useEffect(() => {
    rappel.current = onScan;
  });

  useEffect(() => {
    if (!camera || !video.current) return;
    let arret: (() => void) | undefined;
    let annule = false;
    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const lecteur = new BrowserQRCodeReader();
        const controles = await lecteur.decodeFromVideoDevice(
          undefined,
          video.current!,
          (resultat) => {
            if (!resultat) return;
            controles.stop();
            setCamera(false);
            rappel.current(resultat.getText().trim());
          },
        );
        if (annule) controles.stop();
        else arret = () => controles.stop();
      } catch {
        setErreurCamera(
          "La caméra n'est pas disponible. Autorisez-la dans le navigateur, ou saisissez le code.",
        );
        setCamera(false);
      }
    })();
    return () => {
      annule = true;
      arret?.();
    };
  }, [camera]);

  return (
    <div className={cn("grid gap-3", className)}>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const lu = valeur.trim();
          if (lu) onScan(lu);
          setValeur("");
          champ.current?.focus();
        }}
      >
        <label htmlFor={id} className="text-label font-bold">
          {libelle}
        </label>
        <div className="flex items-center gap-3 rounded-pill bg-blanc pr-2 pl-5 shadow-card focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-nuit">
          <ScanLine aria-hidden className="size-6 shrink-0 text-bleu" />
          <input
            ref={champ}
            id={id}
            value={valeur}
            onChange={(event) => setValeur(event.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            className="min-h-touch w-full bg-transparent text-body-lg outline-none focus-visible:outline-none"
          />
        </div>
      </form>
      {avecCamera ? (
        <>
          <Button
            type="button"
            variant="ghost"
            className="justify-self-start"
            onClick={() => {
              setErreurCamera(null);
              setCamera((c) => !c);
            }}
          >
            {camera ? <CameraOff aria-hidden /> : <Camera aria-hidden />}
            {camera ? "Arrêter la caméra" : "Scanner avec la caméra"}
          </Button>
          {camera ? (
            <video
              ref={video}
              muted
              playsInline
              className="aspect-[4/3] w-full max-w-md rounded-lg bg-nuit object-cover"
            />
          ) : null}
          {erreurCamera ? (
            <p role="alert" className="m-0 font-bold text-alerte">
              {erreurCamera}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/** Title of a settings section, with the way back to the settings list. */
export function EnteteSection({ titre, description }: { titre: string; description?: string }) {
  return (
    <div className="grid gap-2">
      <Link
        href="/parametres"
        className="inline-flex min-h-touch items-center gap-1 self-start font-bold text-bleu no-underline"
      >
        <ChevronLeft aria-hidden className="size-5" />
        Paramètres
      </Link>
      <h1 className="m-0 font-display text-h1 font-semibold">{titre}</h1>
      {description ? <p className="m-0 max-w-3xl text-texte-doux">{description}</p> : null}
    </div>
  );
}

/** Confirmation that repeats the action's verb (design/charte.md). */
export function MessageSucces({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="m-0 rounded-md bg-bleu-voile px-5 py-4 font-bold text-nuit">
      {children}
    </p>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, Repeat } from "lucide-react";
import { Providers } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { seDeconnecter } from "@/app/actions/session";
import { getSessionCourante } from "@/lib/session";
import { AccesRefuse, getEgliseActive, type ContexteEglise } from "@/lib/tenant";
import {
  egliseActiveAffichee,
  eglisesAccessibles,
  pinEstDefini,
} from "@/server/plateforme/espace-personnel";
import { EcranVerrouille, SuiviActivite } from "./verrouillage";

/**
 * Tablet layout of a church: header with the church's name (its logo comes with
 * the storage in step 6), lock screen after 15 minutes of inactivity.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getSessionCourante();
  if (!session) redirect("/connexion");
  // Locked: nothing of the page is rendered until the PIN is entered.
  if (session.verrouillee) return <EcranVerrouille nom={session.nom} />;

  let contexte: ContexteEglise;
  try {
    contexte = await getEgliseActive();
  } catch (erreur) {
    if (erreur instanceof AccesRefuse) redirect("/choisir-eglise");
    throw erreur;
  }
  if (!(await pinEstDefini(contexte.membreId))) redirect("/code-pin");

  const [eglise, eglises] = await Promise.all([
    egliseActiveAffichee(contexte.egliseId),
    eglisesAccessibles(session.userId),
  ]);

  return (
    <Providers>
      <SuiviActivite />
      <div className="grid min-h-dvh grid-rows-[auto_1fr_auto]">
        <header className="flex flex-wrap items-center justify-between gap-4 bg-nuit px-6 py-4 text-blanc">
          <p className="m-0 font-display text-h3 font-semibold" data-testid="eglise-active">
            {eglise?.nom}
          </p>
          <nav className="flex items-center gap-3" aria-label="Compte">
            <span className="hidden text-label text-nuit-doux sm:inline">{session.nom}</span>
            {eglises.length > 1 ? (
              <Button
                asChild
                variant="sombre"
                className="shadow-[inset_0_0_0_2px_var(--color-nuit-doux)]"
              >
                <Link href="/choisir-eglise">
                  <Repeat aria-hidden />
                  Changer d&apos;église
                </Link>
              </Button>
            ) : null}
            <form action={seDeconnecter}>
              <Button
                type="submit"
                variant="sombre"
                className="shadow-[inset_0_0_0_2px_var(--color-nuit-doux)]"
              >
                <LogOut aria-hidden />
                Se déconnecter
              </Button>
            </form>
          </nav>
        </header>
        <div className="mx-auto w-full max-w-6xl px-6 py-8">{children}</div>
        <footer className="py-6 text-center text-caption text-texte-doux">Harvest Kids</footer>
      </div>
    </Providers>
  );
}

import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, Repeat, Settings } from "lucide-react";
import { Providers } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { seDeconnecter } from "@/app/actions/session";
import { peut } from "@/lib/rbac";
import { getSessionCourante } from "@/lib/session";
import { AccesRefuse, getEgliseActive, type ContexteEglise } from "@/lib/tenant";
import {
  egliseActiveAffichee,
  eglisesAccessibles,
  pinEstDefini,
} from "@/server/plateforme/espace-personnel";
import { EcranVerrouille, SuiviActivite } from "./verrouillage";

/**
 * Tablet layout of a church: header with the active church's logo (served by
 * /api/fichiers) and name, Harvest Kids footer, lock screen after 15 minutes of
 * inactivity.
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
          <div className="flex items-center gap-4">
            {/* Light variant on the dark header when the church provided one. */}
            {eglise?.logoClairKey || eglise?.logoKey ? (
              // eslint-disable-next-line @next/next/no-img-element -- authenticated route, not optimisable
              <img
                src={`/api/fichiers/${eglise.logoClairKey ?? eglise.logoKey}`}
                alt={`Logo de ${eglise.nom}`}
                className="h-12 w-auto"
              />
            ) : null}
            <p className="m-0 font-display text-h3 font-semibold" data-testid="eglise-active">
              {eglise?.nom}
            </p>
          </div>
          <nav className="flex items-center gap-3" aria-label="Compte">
            <span className="hidden text-label text-nuit-doux sm:inline">{session.nom}</span>
            {peut(contexte.roles, "eglise.parametrer") || peut(contexte.roles, "classes.gerer") ? (
              <Button
                asChild
                variant="sombre"
                className="shadow-[inset_0_0_0_2px_var(--color-nuit-doux)]"
              >
                <Link href="/parametres">
                  <Settings aria-hidden />
                  Paramètres
                </Link>
              </Button>
            ) : null}
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
        <footer className="flex items-center justify-center gap-2 py-6 text-caption text-texte-doux">
          <Image src="/logo/harvest-kids-icone.svg" alt="" width={20} height={20} />
          Harvest Kids
        </footer>
      </div>
    </Providers>
  );
}

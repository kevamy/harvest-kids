import Image from "next/image";
import { notFound } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { seDeconnecter } from "@/app/actions/session";
import { getSessionCourante } from "@/lib/session";

/**
 * Platform console. Anyone but a super-administrator gets a 404: the console's
 * existence is not even revealed. Outside any church, so no church logo here.
 */
export default async function PlateformeLayout({ children }: LayoutProps<"/plateforme">) {
  const session = await getSessionCourante();
  if (!session?.superAdmin) notFound();

  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr_auto]">
      <header className="flex flex-wrap items-center justify-between gap-4 bg-nuit px-6 py-4 text-blanc">
        <p className="m-0 font-display text-h3 font-semibold">Plateforme Harvest Kids</p>
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
      </header>
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        {session.verrouillee ? (
          <p role="alert" className="rounded-md bg-rose-voile px-5 py-4 font-bold text-alerte">
            Session verrouillée après 15 minutes d&apos;inactivité. Reconnectez-vous avec votre mot
            de passe.
          </p>
        ) : (
          children
        )}
      </div>
      <footer className="flex items-center justify-center gap-2 py-6 text-caption text-texte-doux">
        <Image src="/logo/harvest-kids-icone.svg" alt="" width={20} height={20} />
        Harvest Kids
      </footer>
    </div>
  );
}

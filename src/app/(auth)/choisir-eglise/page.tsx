import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NotchCard } from "@/components/hk/notch-card";
import { Button } from "@/components/ui/button";
import { seDeconnecter } from "@/app/actions/session";
import { getSessionCourante } from "@/lib/session";
import { eglisesAccessibles } from "@/server/plateforme/espace-personnel";
import { ListeEglises } from "../formulaires";

export const metadata: Metadata = { title: "Choisir une église — Harvest Kids" };

export default async function ChoisirEglise() {
  const session = await getSessionCourante();
  if (!session) redirect("/connexion");
  const eglises = await eglisesAccessibles(session.userId);

  return (
    <NotchCard couleur="blanc">
      <h1 className="m-0 font-display text-h2 font-semibold">Choisissez votre église</h1>
      {eglises.length > 0 ? (
        <>
          <p className="mt-2 mb-6 text-texte-doux">
            Vous pourrez changer d&apos;église à tout moment depuis le menu.
          </p>
          <ListeEglises eglises={eglises.map(({ id, nom }) => ({ id, nom }))} />
        </>
      ) : (
        <p className="mt-2 mb-6 text-texte-doux">
          Votre compte n&apos;est rattaché à aucune église active. Demandez à l&apos;administrateur
          de votre église de vous ajouter.
        </p>
      )}
      {session.superAdmin ? (
        <Button asChild variant="sombre" className="mt-6 w-full">
          <Link href="/plateforme">Administrer la plateforme</Link>
        </Button>
      ) : null}
      <form action={seDeconnecter} className="mt-4">
        <Button type="submit" variant="ghost" className="w-full">
          Se déconnecter
        </Button>
      </form>
    </NotchCard>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { droitsSalle } from "@/lib/rbac";
import { AccesRefuse, getTenantDb } from "@/lib/tenant";
import { presenceAutorisee } from "../acces-presence";
import { FicheEnfant } from "./fiche";

export const metadata: Metadata = { title: "Fiche de l'enfant — Harvest Kids" };

/**
 * A child's presence card (lot 3). The page checks the church, the presence and the member's
 * rights itself (droitsPresence: reception desk, infirmerie, RESPONSABLE, ADMIN, or a member
 * assigned to the child's class); otherwise 404.
 */
export default async function PagePresence({ params }: PageProps<"/presences/[id]">) {
  let acces: Awaited<ReturnType<typeof getTenantDb>>;
  try {
    acces = await getTenantDb();
  } catch (erreur) {
    // Locked tablet or no church chosen: the layout shows the lock screen or redirects.
    if (erreur instanceof AccesRefuse) return null;
    throw erreur;
  }
  const autorisee = await presenceAutorisee(acces, (await params).id);
  if (!autorisee) notFound();
  const { fiche, affecte } = autorisee;
  const voirClasse = droitsSalle(acces.contexte.roles, affecte).voir;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="m-0 font-display text-h1 font-semibold">
            {fiche.prenom} {fiche.nom}
          </h1>
          <p className="m-0 text-texte-doux">
            {[fiche.classe, fiche.culte ?? "Session", fiche.sessionOuverte ? null : "clôturée"]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {fiche.sessionClasseId && voirClasse ? (
          <Link href={`/classe/${fiche.sessionClasseId}`}>Liste de la classe</Link>
        ) : null}
      </div>
      <FicheEnfant presenceId={fiche.presenceId} />
    </div>
  );
}

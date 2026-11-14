import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { droitsSalle, peut } from "@/lib/rbac";
import { AccesRefuse, getTenantDb } from "@/lib/tenant";
import { classeDeSession, estAffecte } from "@/server/salle";
import { ListeClasse } from "./liste-classe";

export const metadata: Metadata = { title: "Ma classe — Harvest Kids" };

/**
 * List of a class in a session (cahier §7.4): children to confirm at the top, children in
 * class below, live. The page checks the church, the class and the member's rights itself
 * (droitsSalle: assigned members, or a RESPONSABLE or an ADMIN); otherwise 404.
 */
export default async function PageClasse({ params }: PageProps<"/classe/[id]">) {
  let acces: Awaited<ReturnType<typeof getTenantDb>>;
  try {
    acces = await getTenantDb();
  } catch (erreur) {
    // Locked tablet or no church chosen: the layout shows the lock screen or redirects.
    if (erreur instanceof AccesRefuse) return null;
    throw erreur;
  }
  const { db, contexte } = acces;
  const { id } = await params;
  const classe = await classeDeSession(db, id);
  if (!classe) notFound();
  const droits = droitsSalle(contexte.roles, await estAffecte(db, id, contexte.membreId));
  if (!droits.voir) notFound();

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="m-0 font-display text-h1 font-semibold">{classe.nom}</h1>
          <p className="m-0 text-texte-doux">
            {[classe.culte ?? "Session", classe.salle ? `Salle ${classe.salle}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {peut(contexte.roles, "classe.voir") ? (
          <Link href="/classe">Toutes les classes</Link>
        ) : null}
      </div>
      <ListeClasse sessionClasseId={classe.sessionClasseId} nomClasse={classe.nom} />
    </div>
  );
}

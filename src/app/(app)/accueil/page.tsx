import type { Metadata } from "next";
import Link from "next/link";
import { AlertesClasses } from "@/components/hk/alertes-classes";
import { NotchCard } from "@/components/hk/notch-card";
import { Pastille } from "@/components/hk/status-pill";
import { peut } from "@/lib/rbac";
import { LIBELLES_ROLES } from "@/lib/roles";
import { getSessionCourante } from "@/lib/session";
import { getTenantDb } from "@/lib/tenant";
import { affectationActive } from "@/server/moniteurs-session";
import { classeDeSession } from "@/server/salle";
import { listerSessionsDuJour } from "@/server/sessions";
import { PosteAccueil } from "./poste";

export const metadata: Metadata = { title: "Accueil — Harvest Kids" };

const heure = (h: string) => h.replace(":", " h ");

/**
 * Home of a church member. For the reception team, the desk comes first: the check-in and
 * check-out tabs (cahier §7.3, §7.6), each with its right, and the alerts in a compact band
 * (on the tabs' line in landscape). The full live dashboard comes with lot 4.
 */
export default async function Accueil() {
  const [session, { db, contexte }] = await Promise.all([getSessionCourante(), getTenantDb()]);
  // A member assigned to a class (monitor or reinforcement, whatever the role) reaches its list.
  const affectation = await affectationActive(db, contexte.membreId);
  const maClasse = affectation ? await classeDeSession(db, affectation.sessionClasseId) : null;
  const checkin = peut(contexte.roles, "checkin");
  const checkout = peut(contexte.roles, "checkout");
  const alertes = peut(contexte.roles, "tableau.direct");
  const sessions =
    checkin || checkout
      ? (await listerSessionsDuJour(db))
          .filter((s) => s.statut === "OUVERTE")
          .map((s) => ({
            id: s.id,
            libelle: `${s.culte ?? "Session"} · ${heure(s.heureDebut)} – ${heure(s.heureFin)}`,
          }))
      : [];

  const accueil = (
    <NotchCard couleur="blanc">
      <h1 className="m-0 font-display text-h1 font-semibold">Bonjour {session?.nom}</h1>
      <p className="mt-2 text-texte-doux">Vos rôles dans cette église :</p>
      <ul className="mt-3 flex flex-wrap gap-2" aria-label="Rôles">
        {contexte.roles.map((role) => (
          <li key={role}>
            <Pastille>{LIBELLES_ROLES[role]}</Pastille>
          </li>
        ))}
      </ul>
      {maClasse ? (
        <p className="mt-4 mb-0">
          <Link href={`/classe/${maClasse.sessionClasseId}`} className="font-bold">
            Ouvrir la liste de ma classe : {maClasse.nom}
          </Link>
        </p>
      ) : null}
    </NotchCard>
  );

  if (!checkin && !checkout) {
    return (
      <div className="grid gap-6">
        {accueil}
        {alertes ? <AlertesClasses /> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <PosteAccueil
        sessions={sessions}
        checkin={checkin}
        checkout={checkout}
        alertes={
          alertes ? <AlertesClasses compact className="min-w-0 md:landscape:flex-1" /> : null
        }
      />
      {accueil}
    </div>
  );
}

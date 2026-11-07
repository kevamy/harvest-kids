import type { Metadata } from "next";
import { AlertesClasses } from "@/components/hk/alertes-classes";
import { NotchCard } from "@/components/hk/notch-card";
import { Pastille } from "@/components/hk/status-pill";
import { Button } from "@/components/ui/button";
import { peut } from "@/lib/rbac";
import { LIBELLES_ROLES } from "@/lib/roles";
import { getSessionCourante } from "@/lib/session";
import { getTenantDb } from "@/lib/tenant";
import { listerSessionsDuJour } from "@/server/sessions";
import { Checkin } from "./checkin";

export const metadata: Metadata = { title: "Accueil — Harvest Kids" };

const heure = (h: string) => h.replace(":", " h ");

/**
 * Home of a church member. For the reception team, the desk comes first: the class alerts
 * in a compact band, then the check-in (cahier §7.3), whose tab has the check-out next to it
 * (lot 2, step 5). The full live dashboard comes with lot 4.
 */
export default async function Accueil() {
  const [session, { db, contexte }] = await Promise.all([getSessionCourante(), getTenantDb()]);
  const checkin = peut(contexte.roles, "checkin");
  const alertes = peut(contexte.roles, "tableau.direct");
  const sessions = checkin
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
    </NotchCard>
  );

  if (!checkin) {
    return (
      <div className="grid gap-6">
        {accueil}
        {alertes ? <AlertesClasses /> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4">
        {alertes ? <AlertesClasses compact /> : null}
        {/* One tab today; the check-out (step 5) takes its place next to it. */}
        <div
          role="tablist"
          aria-label="Poste d'accueil"
          className="flex flex-wrap items-center gap-2"
        >
          <Button
            type="button"
            role="tab"
            id="onglet-checkin"
            aria-selected="true"
            aria-controls="panneau-checkin"
            variant="sombre"
          >
            Check-in
          </Button>
          <Button
            type="button"
            role="tab"
            id="onglet-checkout"
            aria-selected="false"
            aria-describedby="checkout-bientot"
            variant="ghost"
            disabled
          >
            Check-out
          </Button>
          <span id="checkout-bientot" className="text-label text-texte-doux">
            Bientôt disponible
          </span>
        </div>
        <div role="tabpanel" id="panneau-checkin" aria-labelledby="onglet-checkin">
          <Checkin sessions={sessions} />
        </div>
      </div>
      {accueil}
    </div>
  );
}

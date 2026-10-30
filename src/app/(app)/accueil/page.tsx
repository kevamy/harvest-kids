import type { Metadata } from "next";
import { Pastille } from "@/components/hk/status-pill";
import { NotchCard } from "@/components/hk/notch-card";
import { getSessionCourante } from "@/lib/session";
import { getEgliseActive } from "@/lib/tenant";

export const metadata: Metadata = { title: "Accueil — Harvest Kids" };

const LIBELLES_ROLES = {
  ADMIN: "Administrateur",
  RESPONSABLE: "Responsable",
  ACCUEIL: "Accueil",
  MONITEUR: "Moniteur",
  INFIRMERIE: "Infirmerie",
  ECRAN: "Écran d'appel",
} as const;

/** Placeholder home: the live dashboard arrives in lot 2. */
export default async function Accueil() {
  const [session, contexte] = await Promise.all([getSessionCourante(), getEgliseActive()]);
  return (
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
}

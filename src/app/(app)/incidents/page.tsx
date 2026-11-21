import type { Metadata } from "next";
import Link from "next/link";
import { NotchCard } from "@/components/hk/notch-card";
import { LIBELLES_INCIDENT, listerIncidents } from "@/server/incidents";
import { contextePage } from "../acces";

export const metadata: Metadata = { title: "Incidents — Harvest Kids" };

/**
 * Incidents of the church (cahier §7.5, §7.6), most recent first, for the RESPONSABLE and the
 * ADMIN. The list never shows a photo: the photo of an exceptional retrieval is only in the
 * incident's detail.
 */
export default async function Incidents() {
  const acces = await contextePage("incidents.voir");
  if (!acces) return null;
  const incidents = await listerIncidents(acces.db);

  return (
    <div className="grid gap-6">
      <h1 className="m-0 font-display text-h1 font-semibold">Incidents</h1>
      <NotchCard couleur="blanc">
        {incidents.length === 0 ? (
          <p className="m-0">Aucun incident enregistré.</p>
        ) : (
          <ul aria-label="Incidents" className="m-0 grid list-none gap-3 p-0">
            {incidents.map((i) => (
              <li
                key={i.id}
                className="grid gap-1 rounded-md px-5 py-4 shadow-[inset_0_0_0_2px_var(--color-ligne)]"
              >
                <Link href={`/incidents/${i.id}`} className="font-bold">
                  {LIBELLES_INCIDENT[i.type]} · {i.date}
                </Link>
                <span className="text-texte-doux">{i.description}</span>
              </li>
            ))}
          </ul>
        )}
      </NotchCard>
    </div>
  );
}

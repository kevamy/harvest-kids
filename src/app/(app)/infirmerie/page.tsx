import type { Metadata } from "next";
import { contextePage } from "../acces";
import { ListeInfirmerie } from "./liste-infirmerie";

export const metadata: Metadata = { title: "Infirmerie — Harvest Kids" };

/**
 * The infirmerie (cahier §7.7, lot 3), live: children on their way (red alert past the
 * church's delay), then children received; receive them, send them back to class, open their
 * card (Urgence, parent call, incident). For the infirmerie, a RESPONSABLE and an ADMIN.
 */
export default async function PageInfirmerie() {
  const acces = await contextePage("infirmerie.gerer", "salle.superviser");
  if (!acces) return null;
  return (
    <div className="grid gap-6">
      <h1 className="m-0 font-display text-h1 font-semibold">Infirmerie</h1>
      <ListeInfirmerie />
    </div>
  );
}

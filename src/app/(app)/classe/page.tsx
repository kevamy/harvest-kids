import type { Metadata } from "next";
import { NotchCard } from "@/components/hk/notch-card";
import { listerSessionsDuJour } from "@/server/sessions";
import { contextePage } from "../acces";
import { ClassesSession } from "../sessions/classes-session";

export const metadata: Metadata = { title: "Classes — Harvest Kids" };

const heure = (h: string) => h.replace(":", " h ");

/**
 * The monitors' arrival (cahier §7.2): in an open session, a monitor joins their class
 * (or scans a monitor's badge to assign them), and leaves it. Joining another class ends the
 * previous assignment.
 */
export default async function Classes() {
  const acces = await contextePage("classe.voir");
  if (!acces) return null;
  const ouvertes = (await listerSessionsDuJour(acces.db)).filter((s) => s.statut === "OUVERTE");

  return (
    <div className="grid gap-6">
      <h1 className="m-0 font-display text-h1 font-semibold">Classes</h1>
      {ouvertes.length === 0 ? (
        <NotchCard couleur="blanc">
          <p className="m-0">
            Aucune session ouverte pour l&apos;instant. Le responsable ouvre la session avant le
            culte ; rechargez ensuite la page.
          </p>
        </NotchCard>
      ) : (
        ouvertes.map((session) => {
          const nom = session.culte ?? "Session";
          return (
            <section key={session.id} aria-label={`Session ${nom}`} className="grid gap-4">
              <h2 className="m-0 font-display text-h2 font-semibold">
                {nom} · {heure(session.heureDebut)} – {heure(session.heureFin)}
              </h2>
              <ClassesSession sessionId={session.id} responsable={false} peutForcer={false} />
            </section>
          );
        })
      )}
    </div>
  );
}

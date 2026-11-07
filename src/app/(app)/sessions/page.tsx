import type { Metadata } from "next";
import Link from "next/link";
import { NotchCard } from "@/components/hk/notch-card";
import { Pastille } from "@/components/hk/status-pill";
import { peut } from "@/lib/rbac";
import { membresAffectablesEglise } from "@/server/plateforme/membres-session";
import { assurerSessionsDuJour, listerSessionsDuJour } from "@/server/sessions";
import { contextePage } from "../acces";
import { BoutonSession } from "./boutons";
import { ClassesSession } from "./classes-session";

export const metadata: Metadata = { title: "Sessions — Harvest Kids" };

const heure = (h: string) => h.replace(":", " h ");

const STATUTS = {
  PLANIFIEE: { libelle: "Planifiée", classes: "text-texte-doux" },
  OUVERTE: { libelle: "Ouverte", classes: "text-succes" },
  CLOTUREE: { libelle: "Clôturée", classes: "text-nuit" },
} as const;

/**
 * Today's sessions (cahier §7.2), created from the church's services on the first visit of
 * the day. The RESPONSABLE opens them, follows the classes and their monitors live, forces a
 * class open and closes the session once every child has been collected.
 */
export default async function Sessions() {
  const acces = await contextePage("sessions.gerer");
  if (!acces) return null;
  await assurerSessionsDuJour(acces.db);
  const [sessions, membres] = await Promise.all([
    listerSessionsDuJour(acces.db),
    membresAffectablesEglise(acces.contexte),
  ]);
  const peutForcer = peut(acces.contexte.roles, "classe.forcer");

  return (
    <div className="grid gap-6">
      <h1 className="m-0 font-display text-h1 font-semibold">Sessions du jour</h1>
      {sessions.length === 0 ? (
        <NotchCard couleur="blanc">
          <p className="m-0">
            Aucun culte aujourd&apos;hui. Les horaires se règlent dans{" "}
            <Link href="/parametres/cultes">Paramètres › Cultes et accueil</Link>.
          </p>
        </NotchCard>
      ) : (
        sessions.map((session) => {
          const nom = session.culte ?? "Session";
          const statut = STATUTS[session.statut];
          return (
            <section
              key={session.id}
              aria-label={`Session ${nom}`}
              aria-describedby={`statut-${session.id}`}
              className="grid gap-4"
            >
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="m-0 font-display text-h2 font-semibold">
                  {nom} · {heure(session.heureDebut)} – {heure(session.heureFin)}
                </h2>
                <span id={`statut-${session.id}`}>
                  <Pastille className={statut.classes}>{statut.libelle}</Pastille>
                </span>
              </div>
              {session.statut === "PLANIFIEE" ? (
                <BoutonSession sessionId={session.id} action="ouvrir" />
              ) : null}
              {session.statut === "OUVERTE" ? (
                <>
                  <ClassesSession
                    sessionId={session.id}
                    responsable
                    peutForcer={peutForcer}
                    membres={membres}
                  />
                  <BoutonSession sessionId={session.id} action="cloturer" />
                </>
              ) : null}
            </section>
          );
        })
      )}
    </div>
  );
}

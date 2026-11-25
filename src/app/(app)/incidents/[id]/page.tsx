import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NotchCard } from "@/components/hk/notch-card";
import { MatriculeBadge } from "@/components/hk/matricule-badge";
import { formaterTelephone } from "@/lib/telephone";
import { LIBELLES_INCIDENT, detailIncident } from "@/server/incidents";
import { nomsMembresEglise } from "@/server/plateforme/membres-session";
import { contextePage } from "../../acces";
import { SuiviIncident } from "./suivi";

export const metadata: Metadata = { title: "Incident — Harvest Kids" };

/**
 * Detail of an incident (RESPONSABLE, ADMIN). For an exceptional retrieval (cahier §7.6): the
 * adult, the reason, who authorised and who handed over, the children, and the adult's photo,
 * shown here only (the file route checks the same right).
 */
export default async function PageIncident({ params }: PageProps<"/incidents/[id]">) {
  const acces = await contextePage("incidents.voir");
  if (!acces) return null;
  const incident = await detailIncident(acces.db, (await params).id);
  if (!incident) notFound();

  const noms = await nomsMembresEglise(acces.contexte, [
    incident.declarePar,
    ...(incident.retrait ? [incident.retrait.autorisePar, incident.retrait.remisPar] : []),
    ...(incident.cloturePar ? [incident.cloturePar] : []),
    ...incident.notes.map((n) => n.auteur),
  ]);
  const nom = (userId: string) => noms.get(userId) ?? "Compte supprimé";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="m-0 font-display text-h1 font-semibold">
          {LIBELLES_INCIDENT[incident.type]}
        </h1>
        <Link href="/incidents">Tous les incidents</Link>
      </div>
      <NotchCard couleur="blanc" aria-label="Incident">
        <dl className="m-0 grid gap-x-6 gap-y-2 md:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="font-bold">Date</dt>
          <dd className="m-0">{incident.date}</dd>
          {incident.enfant ? (
            <>
              <dt className="font-bold">Enfant</dt>
              <dd className="m-0">
                {incident.enfant.prenom} {incident.enfant.nom}
                {incident.enfant.matricule ? ` (${incident.enfant.matricule})` : ""}
              </dd>
            </>
          ) : null}
          <dt className="font-bold">Description</dt>
          <dd className="m-0">{incident.description}</dd>
          {incident.personnes ? (
            <>
              <dt className="font-bold">Personnes présentes</dt>
              <dd className="m-0">{incident.personnes}</dd>
            </>
          ) : null}
          {incident.mesures ? (
            <>
              <dt className="font-bold">Mesures prises</dt>
              <dd className="m-0">{incident.mesures}</dd>
            </>
          ) : null}
          <dt className="font-bold">Déclaré par</dt>
          <dd className="m-0">{nom(incident.declarePar)}</dd>
        </dl>
      </NotchCard>

      {incident.retrait ? (
        <NotchCard couleur="blanc" aria-label="Retrait exceptionnel">
          <div className="grid gap-4">
            <h2 className="m-0 font-display text-h2 font-semibold">Retrait exceptionnel</h2>
            <div className="flex flex-wrap items-start gap-6">
              {/* eslint-disable-next-line @next/next/no-img-element -- authenticated route, not optimisable */}
              <img
                src={`/api/fichiers/${incident.retrait.photoKey}`}
                alt={`Photo de ${incident.retrait.nom}`}
                className="size-40 rounded-md object-cover"
              />
              <dl className="m-0 grid flex-1 gap-x-6 gap-y-2 md:grid-cols-[auto_minmax(0,1fr)]">
                <dt className="font-bold">Adulte</dt>
                <dd className="m-0">
                  {incident.retrait.nom}
                  {incident.retrait.lien ? ` (${incident.retrait.lien})` : ""}
                </dd>
                {incident.retrait.telephone ? (
                  <>
                    <dt className="font-bold">Téléphone</dt>
                    <dd className="m-0">{formaterTelephone(incident.retrait.telephone)}</dd>
                  </>
                ) : null}
                <dt className="font-bold">Motif</dt>
                <dd className="m-0">{incident.retrait.motif}</dd>
                <dt className="font-bold">Autorisé par</dt>
                <dd className="m-0">{nom(incident.retrait.autorisePar)}</dd>
                <dt className="font-bold">Remis par</dt>
                <dd className="m-0">{nom(incident.retrait.remisPar)}</dd>
              </dl>
            </div>
            <ul aria-label="Enfants remis" className="m-0 flex list-none flex-wrap gap-4 p-0">
              {incident.retrait.enfants.map((e) => (
                <li key={`${e.prenom}-${e.matricule}`} className="flex items-center gap-3">
                  {e.matricule ? <MatriculeBadge matricule={e.matricule} taille="sm" /> : null}
                  <span className="font-bold">{e.prenom}</span>
                </li>
              ))}
            </ul>
          </div>
        </NotchCard>
      ) : null}

      <SuiviIncident
        incidentId={incident.id}
        clos={
          incident.clotureLe && incident.cloturePar
            ? { le: incident.clotureLe, par: nom(incident.cloturePar) }
            : null
        }
        notes={incident.notes.map((n) => ({ ...n, auteur: nom(n.auteur) }))}
      />
    </div>
  );
}

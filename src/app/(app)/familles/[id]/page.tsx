import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, TriangleAlert, UserRound } from "lucide-react";
import { MatriculeBadge } from "@/components/hk/matricule-badge";
import { NotchCard } from "@/components/hk/notch-card";
import { Button } from "@/components/ui/button";
import { peut } from "@/lib/rbac";
import { formaterTelephone, lienTelephone } from "@/lib/telephone";
import { listerCartesFamille } from "@/server/cartes/lecture";
import { ALERTES_RAPIDES, lireFamille } from "@/server/familles";
import { CartesFamille } from "./cartes";
import { contextePage } from "../../acces";
import { MessageSucces } from "../../parametres/entete";

export const metadata: Metadata = { title: "Famille — Harvest Kids" };

const LIBELLE_ALERTE = Object.fromEntries(ALERTES_RAPIDES.map((a) => [a.code, a.libelle]));
const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" });

function Vignette({ cle, alt }: { cle: string | null; alt: string }) {
  return (
    <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-md bg-creme">
      {cle ? (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated route, not optimisable
        <img src={`/api/fichiers/${cle}`} alt={alt} className="size-full object-cover" />
      ) : (
        <UserRound aria-hidden className="size-8 text-texte-doux" />
      )}
    </div>
  );
}

// Confirmation after a save, repeating the button's verb (design/charte.md).
const CONFIRMATIONS: Record<string, string> = {
  inscription: "Inscription enregistrée.",
  finalisation: "Inscription finalisée : les enfants ont leur matricule.",
  modification: "Modifications enregistrées.",
};

/** Family record. Readable with familles.gerer or checkin; changes need familles.gerer. */
export default async function FicheFamille({ params, searchParams }: PageProps<"/familles/[id]">) {
  const acces = await contextePage("familles.gerer", "checkin");
  if (!acces) return null;
  const gerer = peut(acces.contexte.roles, "familles.gerer");
  const { confirmation } = await searchParams;
  const message = typeof confirmation === "string" ? CONFIRMATIONS[confirmation] : undefined;
  // A family of another church is invisible (scoped client): same 404 as a missing one.
  const fiche = await lireFamille(acces.db, (await params).id);
  if (!fiche) notFound();
  const brouillon = fiche.finaliseeLe === null;
  const cartes = brouillon || !gerer ? [] : await listerCartesFamille(acces.db, fiche.id);
  const adultes = [
    ...fiche.tuteurs
      .filter((t) => t.autorise?.actif)
      .map((t) => ({
        id: t.id,
        prenom: t.prenom,
        nom: t.nom,
        lien: t.lien,
        photoKey: t.autorise!.photoKey,
      })),
    ...fiche.autorises.filter((a) => a.actif),
  ];

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="m-0 font-display text-h1 font-semibold">Famille {fiche.nom}</h1>
        {gerer ? (
          <Button asChild variant={brouillon ? "bleu" : "ghost"}>
            <Link href={`/familles/${fiche.id}/modifier`}>
              <Pencil aria-hidden />
              {brouillon ? "Finaliser l'inscription" : "Modifier la famille"}
            </Link>
          </Button>
        ) : null}
      </div>

      {message ? <MessageSucces>{message}</MessageSucces> : null}

      {brouillon ? (
        <div role="note" className="flex gap-3 rounded-md bg-soleil px-5 py-4 text-nuit">
          <TriangleAlert aria-hidden className="mt-0.5 size-6 shrink-0" />
          <p className="m-0">
            Famille à compléter : pas de matricule, pas de carte et pas de check-in tant que
            l&apos;inscription n&apos;est pas finalisée.
          </p>
        </div>
      ) : null}

      <NotchCard couleur="blanc">
        <h2 className="m-0 mb-4 font-display text-h2 font-semibold">Enfants</h2>
        <ul className="m-0 grid list-none gap-4 p-0">
          {fiche.enfants.map((e) => (
            <li key={e.id} className={e.actif ? "flex gap-4" : "flex gap-4 opacity-60"}>
              <Vignette cle={e.photoKey} alt={`Photo de ${e.prenom}`} />
              <div className="grid gap-1">
                <p className="m-0 flex flex-wrap items-center gap-3 font-bold">
                  {e.prenom} {e.nom}
                  {e.matricule ? <MatriculeBadge matricule={e.matricule} /> : null}
                  {e.actif ? null : (
                    <span className="text-label text-texte-doux">ne vient plus</span>
                  )}
                </p>
                <p className="m-0 text-texte-doux">Né(e) le {DATE.format(e.dateNaissance)}</p>
                {e.alertes.length > 0 || e.alerteDetail ? (
                  <p className="m-0 font-bold text-alerte">
                    Alerte :{" "}
                    {[...e.alertes.map((a) => LIBELLE_ALERTE[a] ?? a), e.alerteDetail]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </NotchCard>

      <div className="grid gap-6 md:grid-cols-2">
        <NotchCard couleur="blanc">
          <h2 className="m-0 mb-4 font-display text-h2 font-semibold">Tuteurs</h2>
          <ul className="m-0 grid list-none gap-3 p-0">
            {fiche.tuteurs.map((t) => (
              <li key={t.id}>
                <p className="m-0 font-bold">
                  {t.prenom} {t.nom}
                  {t.lien ? ` (${t.lien})` : ""}
                  {t.principal ? " · contact principal" : ""}
                </p>
                <p className="m-0">
                  {/* The main contact of a saved family always has one; a draft's may not. */}
                  {t.telephone ? (
                    <a href={lienTelephone(t.telephone) ?? undefined}>
                      {formaterTelephone(t.telephone)}
                    </a>
                  ) : (
                    <span className="text-texte-doux">
                      {brouillon && t.principal ? "Téléphone à compléter" : "Sans numéro"}
                    </span>
                  )}
                  {t.telephone2 ? <> · {formaterTelephone(t.telephone2)}</> : null}
                </p>
              </li>
            ))}
          </ul>
        </NotchCard>
        <NotchCard couleur="blanc">
          <h2 className="m-0 mb-4 font-display text-h2 font-semibold">Personnes autorisées</h2>
          {adultes.length === 0 ? (
            <p className="m-0 text-texte-doux">Aucune personne autorisée pour l&apos;instant.</p>
          ) : (
            <ul className="m-0 grid list-none gap-3 p-0">
              {adultes.map((a) => (
                <li key={a.id} className="flex items-center gap-4">
                  <Vignette cle={a.photoKey} alt={`Photo de ${a.prenom} ${a.nom}`} />
                  <span className="font-bold">
                    {a.prenom} {a.nom}{" "}
                    <span className="font-normal text-texte-doux">({a.lien})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </NotchCard>
      </div>

      {brouillon || !gerer ? null : (
        <NotchCard couleur="blanc">
          <h2 className="m-0 mb-4 font-display text-h2 font-semibold">Cartes</h2>
          <CartesFamille
            familleId={fiche.id}
            cartes={cartes.map((c) => ({
              id: c.id,
              emiseLe: c.emiseLe.toISOString(),
              activeLe: c.activeLe?.toISOString() ?? null,
              revoqueeLe: c.revoqueeLe?.toISOString() ?? null,
              enfant: c.enfant ? c.enfant.prenom : null,
            }))}
          />
        </NotchCard>
      )}

      <NotchCard couleur="blanc">
        <h2 className="m-0 mb-2 font-display text-h2 font-semibold">Consentements</h2>
        <p className="m-0">
          Données :{" "}
          {fiche.consentementDonnees
            ? `donné le ${DATE.format(fiche.consentementDonnees)}`
            : "non recueilli"}
        </p>
        <p className="m-0">
          Photos des enfants :{" "}
          {fiche.consentementPhotos
            ? `donné le ${DATE.format(fiche.consentementPhotos)}`
            : "non donné"}
        </p>
      </NotchCard>
    </div>
  );
}

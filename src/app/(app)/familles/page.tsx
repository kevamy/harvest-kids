import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, ScanLine, Search, Upload } from "lucide-react";
import { MatriculeBadge } from "@/components/hk/matricule-badge";
import { NotchCard } from "@/components/hk/notch-card";
import { Pastille } from "@/components/hk/status-pill";
import { Button } from "@/components/ui/button";
import { peut } from "@/lib/rbac";
import { formaterTelephone } from "@/lib/telephone";
import {
  listerBrouillons,
  listerFamillesInscrites,
  rechercherFamilles,
  type EtatCarteFamille,
} from "@/server/familles";
import { contextePage } from "../acces";

export const metadata: Metadata = { title: "Familles — Harvest Kids" };

type Resume = Awaited<ReturnType<typeof rechercherFamilles>>[number];
type Inscrite = Awaited<ReturnType<typeof listerFamillesInscrites>>["familles"][number];

const CARTES: Record<EtatCarteFamille, { libelle: string; classes: string }> = {
  active: { libelle: "Carte active", classes: "text-succes" },
  en_attente: { libelle: "Carte en attente de remise", classes: "text-nuit" },
  aucune: { libelle: "Sans carte", classes: "text-texte-doux" },
};

const LIEN_FAMILLE =
  "flex min-h-touch flex-wrap items-center gap-3 rounded-md bg-blanc px-5 py-3 text-nuit no-underline shadow-[inset_0_0_0_2px_var(--color-ligne)]";

function ListeFamilles({ familles, vide }: { familles: Resume[]; vide: string }) {
  if (familles.length === 0) return <p className="m-0 text-texte-doux">{vide}</p>;
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {familles.map((f) => (
        <li key={f.id}>
          <Link href={`/familles/${f.id}`} className={LIEN_FAMILLE}>
            <span className="font-display text-h3 font-semibold">Famille {f.nom}</span>
            <span className="flex flex-wrap gap-2">
              {f.enfants.map((e, i) =>
                e.matricule ? (
                  <MatriculeBadge key={i} matricule={e.matricule} />
                ) : (
                  <span key={i} className="text-texte-doux">
                    {e.prenom}
                  </span>
                ),
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function FamilleInscrite({ famille }: { famille: Inscrite }) {
  const carte = CARTES[famille.carte];
  return (
    <Link
      href={`/familles/${famille.id}`}
      aria-label={`Famille ${famille.nom}`}
      className={`${LIEN_FAMILLE} justify-between`}
    >
      <span className="grid gap-1">
        <span className="font-display text-h3 font-semibold">Famille {famille.nom}</span>
        {/* Eldest first; a first name and its matricule never split across lines. */}
        <span className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          {famille.enfants.map((e, i) => (
            <span key={i} className="inline-flex items-baseline gap-2 whitespace-nowrap">
              <span className="text-body-lg font-bold">{e.prenom}</span>
              {e.matricule ? <MatriculeBadge matricule={e.matricule} taille="sm" /> : null}
            </span>
          ))}
        </span>
        {famille.contact ? (
          <span className="text-label text-texte-doux">
            Contact principal : {famille.contact.prenom} {famille.contact.nom}
            {famille.contact.telephone ? ` · ${formaterTelephone(famille.contact.telephone)}` : ""}
          </span>
        ) : null}
      </span>
      <Pastille className={carte.classes}>{carte.libelle}</Pastille>
    </Link>
  );
}

/**
 * Search, registered families and drafts to complete (cahier §7.1). Read-only: nothing is
 * written here. Readable with familles.gerer or checkin; managing actions need their right.
 */
export default async function Familles({ searchParams }: PageProps<"/familles">) {
  const acces = await contextePage("familles.gerer", "checkin");
  if (!acces) return null;
  const gerer = peut(acces.contexte.roles, "familles.gerer");
  const parametres = await searchParams;
  const terme = typeof parametres.q === "string" ? parametres.q.slice(0, 80) : "";
  const pageDemandee = typeof parametres.page === "string" ? Number(parametres.page) : 1;
  const [resultats, inscrites, brouillons] = await Promise.all([
    terme ? rechercherFamilles(acces.db, terme) : Promise.resolve([]),
    listerFamillesInscrites(acces.db, pageDemandee),
    gerer ? listerBrouillons(acces.db) : Promise.resolve([]),
  ]);
  const lienPage = (page: number) => {
    const suite = new URLSearchParams({ ...(terme ? { q: terme } : {}), page: String(page) });
    return `/familles?${suite.toString()}#familles-inscrites`;
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="m-0 font-display text-h1 font-semibold">Familles</h1>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="ghost">
            <Link href="/cartes/verifier">
              <ScanLine aria-hidden />
              Vérifier une carte
            </Link>
          </Button>
          {peut(acces.contexte.roles, "familles.importer") ? (
            <Button asChild variant="ghost">
              <Link href="/familles/importer">
                <Upload aria-hidden />
                Importer des familles
              </Link>
            </Button>
          ) : null}
          {gerer ? (
            <Button asChild variant="bleu">
              <Link href="/familles/nouvelle">
                <Plus aria-hidden />
                Inscrire une famille
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <NotchCard couleur="blanc">
        <form role="search" action="/familles" className="grid gap-3">
          <label htmlFor="q" className="text-label font-bold">
            Rechercher une famille
          </label>
          <div className="flex flex-wrap gap-3">
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={terme}
              placeholder="Nom d'enfant ou de parent, téléphone, matricule"
              className="min-h-touch flex-1 rounded-md bg-blanc px-5 text-body-lg shadow-[inset_0_0_0_2px_var(--color-ligne)]"
            />
            <Button type="submit" variant="bleu">
              <Search aria-hidden />
              Rechercher
            </Button>
          </div>
        </form>
        {terme ? (
          <section aria-label="Résultats" className="mt-5">
            <ListeFamilles
              familles={resultats}
              vide="Aucune famille trouvée. Vérifiez l'orthographe ou cherchez par téléphone ou matricule."
            />
          </section>
        ) : null}
      </NotchCard>

      <NotchCard couleur="blanc">
        <section aria-labelledby="familles-inscrites" className="grid gap-4">
          <h2 id="familles-inscrites" className="m-0 font-display text-h2 font-semibold">
            Familles inscrites ({inscrites.total})
          </h2>
          {inscrites.total === 0 ? (
            <p className="m-0 text-texte-doux">
              Aucune famille inscrite pour l&apos;instant.
              {gerer ? " Inscrivez la première avec « Inscrire une famille »." : ""}
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-3 p-0" aria-label="Familles inscrites">
              {inscrites.familles.map((f) => (
                <li key={f.id}>
                  <FamilleInscrite famille={f} />
                </li>
              ))}
            </ul>
          )}
          {inscrites.pages > 1 ? (
            <nav
              aria-label="Pages des familles inscrites"
              className="flex flex-wrap items-center gap-3"
            >
              {inscrites.page > 1 ? (
                <Button asChild variant="ghost">
                  <Link href={lienPage(inscrites.page - 1)}>
                    <ChevronLeft aria-hidden />
                    Page précédente
                  </Link>
                </Button>
              ) : null}
              <span aria-current="page">
                Page {inscrites.page} sur {inscrites.pages}
              </span>
              {inscrites.page < inscrites.pages ? (
                <Button asChild variant="ghost">
                  <Link href={lienPage(inscrites.page + 1)}>
                    Page suivante
                    <ChevronRight aria-hidden />
                  </Link>
                </Button>
              ) : null}
            </nav>
          ) : null}
        </section>
      </NotchCard>

      {gerer ? (
        <NotchCard couleur="blanc">
          <h2 className="m-0 mb-2 font-display text-h2 font-semibold">À compléter</h2>
          <p className="mt-0 mb-4 text-texte-doux">
            Familles importées, sans matricule ni carte tant qu&apos;elles ne sont pas finalisées à
            l&apos;accueil.
          </p>
          <section aria-label="Familles à compléter">
            <ListeFamilles familles={brouillons} vide="Aucune famille à compléter." />
          </section>
        </NotchCard>
      ) : null}
    </div>
  );
}

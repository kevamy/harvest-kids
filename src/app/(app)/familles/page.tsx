import type { Metadata } from "next";
import Link from "next/link";
import { Plus, ScanLine, Search } from "lucide-react";
import { MatriculeBadge } from "@/components/hk/matricule-badge";
import { NotchCard } from "@/components/hk/notch-card";
import { Button } from "@/components/ui/button";
import { listerBrouillons, rechercherFamilles } from "@/server/familles";
import { contextePage } from "../acces";

export const metadata: Metadata = { title: "Familles — Harvest Kids" };

type Resume = Awaited<ReturnType<typeof rechercherFamilles>>[number];

function ListeFamilles({ familles, vide }: { familles: Resume[]; vide: string }) {
  if (familles.length === 0) return <p className="m-0 text-texte-doux">{vide}</p>;
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {familles.map((f) => (
        <li key={f.id}>
          <Link
            href={`/familles/${f.id}`}
            className="flex min-h-touch flex-wrap items-center gap-3 rounded-md bg-blanc px-5 py-3 text-nuit no-underline shadow-[inset_0_0_0_2px_var(--color-ligne)]"
          >
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

/** Search and drafts to complete (cahier §7.1). Read-only: nothing is written here. */
export default async function Familles({ searchParams }: PageProps<"/familles">) {
  const acces = await contextePage("familles.gerer");
  if (!acces) return null;
  const q = (await searchParams).q;
  const terme = typeof q === "string" ? q.slice(0, 80) : "";
  const [resultats, brouillons] = await Promise.all([
    terme ? rechercherFamilles(acces.db, terme) : Promise.resolve([]),
    listerBrouillons(acces.db),
  ]);

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
          <Button asChild variant="bleu">
            <Link href="/familles/nouvelle">
              <Plus aria-hidden />
              Inscrire une famille
            </Link>
          </Button>
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
        <h2 className="m-0 mb-2 font-display text-h2 font-semibold">À compléter</h2>
        <p className="mt-0 mb-4 text-texte-doux">
          Familles importées, sans matricule ni carte tant qu&apos;elles ne sont pas finalisées à
          l&apos;accueil.
        </p>
        <section aria-label="Familles à compléter">
          <ListeFamilles familles={brouillons} vide="Aucune famille à compléter." />
        </section>
      </NotchCard>
    </div>
  );
}

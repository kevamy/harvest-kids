"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FileSearch, Upload } from "lucide-react";
import { NotchCard } from "@/components/hk/notch-card";
import { Button } from "@/components/ui/button";
import { MessageErreur } from "@/components/ui/champ";
import { RESEAU_INDISPONIBLE } from "@/lib/appel-action";
import { formaterTelephone } from "@/lib/telephone";
import {
  idCorrection,
  type FamilleImportee,
  type TelephoneLu,
} from "@/server/import-familles/analyse";
import type { ApercuImport, RapportImport } from "@/server/import-familles/service";
import { MessageSucces } from "../../parametres/entete";
import { analyser, importer } from "./actions";

const ENCODAGES = {
  "utf-8-bom": "UTF-8 avec BOM",
  "utf-8": "UTF-8",
  "windows-1252": "Windows-1252",
} as const;

const date = (iso: string) => iso.split("-").reverse().join("/");

function Telephone({ telephone }: { telephone: TelephoneLu }) {
  switch (telephone.statut) {
    case "valide":
      return <>{formaterTelephone(telephone.e164)}</>;
    case "a_confirmer":
      return <>{telephone.saisi} (à confirmer)</>;
    case "illisible":
      return <span className="text-alerte">numéro illisible</span>;
    case "absent":
      return <span className="text-texte-doux">sans numéro</span>;
  }
}

function Famille({ famille }: { famille: FamilleImportee }) {
  return (
    <div className="grid gap-1">
      <p className="m-0 font-bold">
        Famille {famille.nom}{" "}
        <span className="font-normal text-texte-doux">
          (ligne{famille.lignes.length > 1 ? "s" : ""} {famille.lignes.join(", ")})
        </span>
      </p>
      <p className="m-0">
        {famille.enfants.map((e) => `${e.prenom} ${e.nom}, ${date(e.dateNaissance)}`).join(" · ")}
      </p>
      {famille.tuteurs.length > 0 ? (
        <p className="m-0 text-label">
          {famille.tuteurs.map((t, i) => (
            <span key={i}>
              {i > 0 ? " · " : ""}
              {t.prenom} {t.nom}
              {t.lien ? ` (${t.lien})` : ""} : <Telephone telephone={t.telephone} />
            </span>
          ))}
        </p>
      ) : null}
      {famille.avertissements.length > 0 ? (
        <ul className="m-0 grid gap-1 pl-5 text-label text-texte-doux">
          {famille.avertissements.map((a, i) =>
            a.important ? (
              <li key={i} className="rounded-md bg-soleil px-3 py-1 font-bold text-nuit">
                À vérifier, ligne {a.ligne} : {a.message}
              </li>
            ) : (
              <li key={i}>
                Ligne {a.ligne} : {a.message}
              </li>
            ),
          )}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Preview, then import (ADR 0013). The file stays in the browser between the two steps
 * and is sent again with the choices; the server checks it is the same file.
 */
export function Importeur() {
  const [fichier, setFichier] = useState<File | null>(null);
  const [apercu, setApercu] = useState<ApercuImport | null>(null);
  const [corrections, setCorrections] = useState<Set<string>>(new Set());
  const [doublons, setDoublons] = useState<Set<string>>(new Set());
  const [rapport, setRapport] = useState<RapportImport | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  const recommencer = () => {
    setApercu(null);
    setRapport(null);
    setErreur(null);
    setCorrections(new Set());
    setDoublons(new Set());
  };

  const lancerAnalyse = () =>
    demarrer(async () => {
      if (!fichier) return;
      recommencer();
      const formulaire = new FormData();
      formulaire.set("fichier", fichier);
      try {
        const resultat = await analyser(formulaire);
        if (resultat.ok) setApercu(resultat.donnees);
        else setErreur(resultat.erreur);
      } catch {
        setErreur(RESEAU_INDISPONIBLE);
      }
    });

  const aConfirmer = (apercu?.familles ?? []).flatMap((f) =>
    f.tuteurs.flatMap((t, rang) =>
      t.telephone.statut === "a_confirmer"
        ? [{ id: idCorrection(f.ref, rang), famille: f, rang, telephone: t.telephone }]
        : [],
    ),
  );
  const sansDoublon = (apercu?.familles ?? []).filter((f) => f.doublons.length === 0);
  const avecDoublon = (apercu?.familles ?? []).filter((f) => f.doublons.length > 0);
  const aImporter = sansDoublon.length + avecDoublon.filter((f) => doublons.has(f.ref)).length;
  const nomsRepris = (apercu?.familles ?? []).reduce(
    (n, f) => n + f.avertissements.filter((a) => a.important).length,
    0,
  );

  const basculer = (ensemble: Set<string>, id: string, coche: boolean) => {
    const copie = new Set(ensemble);
    if (coche) copie.add(id);
    else copie.delete(id);
    return copie;
  };

  const lancerImport = () =>
    demarrer(async () => {
      if (!fichier || !apercu) return;
      setErreur(null);
      const formulaire = new FormData();
      formulaire.set("fichier", fichier);
      formulaire.set(
        "choix",
        JSON.stringify({
          empreinte: apercu.empreinte,
          corrections: [...corrections],
          doublons: [...doublons],
        }),
      );
      try {
        const resultat = await importer(formulaire);
        if (resultat.ok) {
          setRapport(resultat.donnees);
          setApercu(null);
        } else {
          setErreur(resultat.erreur);
        }
      } catch {
        // The server may have imported before the connection dropped: never assume either way.
        setErreur(
          "Le serveur n'a pas répondu : l'import a peut-être eu lieu. Vérifiez la liste « À compléter » avant de recommencer.",
        );
      }
    });

  if (rapport) {
    const nonValides = rapport.importees.reduce((n, f) => n + f.nonValides, 0);
    return (
      <NotchCard couleur="blanc">
        <div className="grid gap-4">
          <MessageSucces>
            Familles importées : {rapport.importees.length}. Elles sont dans la liste « À compléter
            ».
          </MessageSucces>
          {nonValides > 0 ? (
            <p className="m-0">
              {nonValides} numéro(s) non validé(s) : les tuteurs concernés sont importés sans
              numéro, à compléter à la finalisation.
            </p>
          ) : null}
          {rapport.ecartees.length > 0 ? (
            <section aria-labelledby="ecartees" className="grid gap-2">
              <h2 id="ecartees" className="m-0 font-display text-h3 font-semibold">
                Familles non importées (doublons possibles)
              </h2>
              <ul className="m-0 grid gap-1 pl-5">
                {rapport.ecartees.map((f) => (
                  <li key={f.ref}>
                    Famille {f.nom} : {f.raison}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {rapport.rejets.length > 0 ? (
            <section aria-labelledby="rejets-rapport" className="grid gap-2">
              <h2 id="rejets-rapport" className="m-0 font-display text-h3 font-semibold">
                Lignes rejetées
              </h2>
              <ul className="m-0 grid gap-1 pl-5">
                {rapport.rejets.map((r) => (
                  <li key={r.ligne}>
                    Ligne {r.ligne} : {r.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="bleu">
              <Link href="/familles">Voir les familles à compléter</Link>
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                recommencer();
                setFichier(null);
              }}
            >
              Importer un autre fichier
            </Button>
          </div>
        </div>
      </NotchCard>
    );
  }

  return (
    <div className="grid gap-6">
      <NotchCard couleur="blanc">
        <div className="grid gap-4">
          <label htmlFor="fichier-import" className="text-label font-bold">
            Fichier CSV
          </label>
          <input
            id="fichier-import"
            type="file"
            accept=".csv,text/csv"
            className="min-h-touch"
            onChange={(e) => {
              setFichier(e.target.files?.[0] ?? null);
              recommencer();
            }}
          />
          <Button
            variant="bleu"
            className="justify-self-start"
            disabled={!fichier || enCours}
            onClick={lancerAnalyse}
          >
            <FileSearch aria-hidden />
            Analyser le fichier
          </Button>
          {erreur && !apercu ? <MessageErreur>{erreur}</MessageErreur> : null}
        </div>
      </NotchCard>

      {apercu ? (
        <>
          <NotchCard couleur="blanc">
            <div className="grid gap-2">
              <h2 className="m-0 font-display text-h2 font-semibold">Prévisualisation</h2>
              <p className="m-0" data-testid="import-resume">
                {apercu.lignesLues} ligne(s) lue(s) : {sansDoublon.length} famille(s) prête(s),{" "}
                {avecDoublon.length} doublon(s) possible(s), {apercu.rejets.length} ligne(s)
                rejetée(s).
              </p>
              <p className="m-0 text-label text-texte-doux">
                Encodage {ENCODAGES[apercu.encodage]}, séparateur «{" "}
                {apercu.separateur === ";" ? "point-virgule" : "virgule"} ». Rien n&apos;est
                enregistré avant « Importer ».
              </p>
              {apercu.remarques.length > 0 || nomsRepris > 0 ? (
                <div role="note" className="grid gap-1 rounded-md bg-soleil px-5 py-4 text-nuit">
                  {apercu.remarques.map((r, i) => (
                    <p key={i} className="m-0 font-bold">
                      {r}
                    </p>
                  ))}
                  {nomsRepris > 0 ? (
                    <p className="m-0 font-bold">
                      {nomsRepris} nom(s) repris d&apos;une autre colonne : vérifiez les lignes
                      marquées « À vérifier » avant d&apos;importer.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {apercu.colonnesIgnorees.length > 0 ? (
                <p className="m-0 text-label">
                  Colonnes ignorées : {apercu.colonnesIgnorees.join(", ")}.
                </p>
              ) : null}
            </div>
          </NotchCard>

          {aConfirmer.length > 0 ? (
            <NotchCard couleur="blanc">
              <section aria-labelledby="corrections" className="grid gap-3">
                <h2 id="corrections" className="m-0 font-display text-h2 font-semibold">
                  Numéros à confirmer
                </h2>
                <p className="m-0 text-texte-doux">
                  Ancien format béninois à 8 chiffres. Validez la correction proposée ; sans
                  validation, le tuteur est importé sans ce numéro, à compléter à la finalisation.
                </p>
                <ul className="m-0 grid list-none gap-2 p-0">
                  {aConfirmer.map((c) => (
                    <li key={c.id}>
                      <label className="flex min-h-touch items-center gap-3">
                        <input
                          type="checkbox"
                          className="size-6 accent-bleu"
                          checked={corrections.has(c.id)}
                          onChange={(e) =>
                            setCorrections((s) => basculer(s, c.id, e.target.checked))
                          }
                        />
                        <span>
                          Famille {c.famille.nom}, tuteur {c.rang + 1} : « {c.telephone.saisi} »
                          devient <strong>{c.telephone.proposition}</strong>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="ghost"
                  className="justify-self-start"
                  onClick={() => setCorrections(new Set(aConfirmer.map((c) => c.id)))}
                >
                  Valider toutes les corrections
                </Button>
              </section>
            </NotchCard>
          ) : null}

          {avecDoublon.length > 0 ? (
            <NotchCard couleur="blanc">
              <section aria-labelledby="doublons" className="grid gap-3">
                <h2 id="doublons" className="m-0 font-display text-h2 font-semibold">
                  Doublons possibles
                </h2>
                <p className="m-0 text-texte-doux">
                  Ces familles semblent déjà exister. Elles ne sont pas importées, sauf si vous
                  cochez « Importer quand même ».
                </p>
                <ul className="m-0 grid list-none gap-4 p-0">
                  {avecDoublon.map((f) => (
                    <li key={f.ref} className="grid gap-2 rounded-md bg-creme px-5 py-4">
                      <Famille famille={f} />
                      <ul className="m-0 grid gap-1 pl-5 font-bold">
                        {f.doublons.map((d, i) => (
                          <li key={i}>
                            {d.message}{" "}
                            {d.familleId ? (
                              <Link
                                href={`/familles/${d.familleId}`}
                                target="_blank"
                                className="font-normal"
                              >
                                Voir la fiche
                              </Link>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      <label className="flex min-h-touch items-center gap-3 font-bold">
                        <input
                          type="checkbox"
                          className="size-6 accent-bleu"
                          checked={doublons.has(f.ref)}
                          onChange={(e) => setDoublons((s) => basculer(s, f.ref, e.target.checked))}
                        />
                        Importer quand même la famille {f.nom}
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            </NotchCard>
          ) : null}

          {sansDoublon.length > 0 ? (
            <NotchCard couleur="blanc">
              <section aria-labelledby="pretes" className="grid gap-3">
                <h2 id="pretes" className="m-0 font-display text-h2 font-semibold">
                  Familles prêtes à importer
                </h2>
                <ul className="m-0 grid list-none gap-4 p-0">
                  {sansDoublon.map((f) => (
                    <li key={f.ref}>
                      <Famille famille={f} />
                    </li>
                  ))}
                </ul>
              </section>
            </NotchCard>
          ) : null}

          {apercu.rejets.length > 0 ? (
            <NotchCard couleur="blanc">
              <section aria-labelledby="rejets" className="grid gap-3">
                <h2 id="rejets" className="m-0 font-display text-h2 font-semibold">
                  Lignes rejetées
                </h2>
                <p className="m-0 text-texte-doux">
                  Elles ne seront pas importées. Corrigez-les dans le fichier pour les importer plus
                  tard.
                </p>
                <ul className="m-0 grid gap-1 pl-5">
                  {apercu.rejets.map((r) => (
                    <li key={r.ligne}>
                      Ligne {r.ligne} : {r.message}
                    </li>
                  ))}
                </ul>
              </section>
            </NotchCard>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="bleu" disabled={aImporter === 0 || enCours} onClick={lancerImport}>
              <Upload aria-hidden />
              Importer {aImporter} famille{aImporter > 1 ? "s" : ""}
            </Button>
            {erreur ? <MessageErreur>{erreur}</MessageErreur> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

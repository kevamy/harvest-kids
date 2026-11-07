"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LogIn, LogOut, TriangleAlert, UserPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { NotchCard } from "@/components/hk/notch-card";
import { Scanner } from "@/components/hk/scanner";
import { Pastille } from "@/components/hk/status-pill";
import { Button } from "@/components/ui/button";
import { Champ, MessageErreur } from "@/components/ui/champ";
import { appelerAction } from "@/lib/appel-action";
import { useLiveQuery } from "@/lib/live-query";
import type { EtatSessionDirect } from "@/app/api/direct/sessions/[id]/route";
import type { MembreAffectable } from "@/server/moniteurs-session";
import { MessageSucces } from "../parametres/entete";
import {
  forcerLOuverture,
  identifierBadge,
  quitterLaClasse,
  rejoindreUneClasse,
  type Arrivee,
} from "./actions";
import { optionsAjout } from "./options-ajout";

type Classe = EtatSessionDirect["classes"][number];

/** State of a class; its id describes the class card (aria-describedby). */
function Etat({ classe, id }: { classe: Classe; id: string }) {
  const effectif = `${classe.moniteurs.length}/${classe.minMoniteurs} moniteurs`;
  // A forced class under its minimum is an alert that says why it is open.
  const [texte, couleur] = classe.sousMinimum
    ? [
        classe.forcee ? `Ouverture forcée : ${effectif}` : `Sous le minimum : ${effectif}`,
        "text-alerte",
      ]
    : classe.ouverte
      ? [classe.forcee ? "Ouverte (forcée)" : "Ouverte", "text-succes"]
      : [`Fermée : ${effectif}`, "text-texte-doux"];
  return (
    <span id={id}>
      <Pastille className={couleur}>{texte}</Pastille>
    </span>
  );
}

/**
 * Classes of an open session, live (useLiveQuery). The monitor joins or leaves a class, or
 * scans a monitor's badge first; the RESPONSABLE also adds a monitor or a reinforcement,
 * makes one leave and forces a class open with a reason (RG-05).
 */
export function ClassesSession({
  sessionId,
  responsable,
  peutForcer,
  membres = [],
}: {
  sessionId: string;
  responsable: boolean;
  peutForcer: boolean;
  membres?: MembreAffectable[];
}) {
  const cle = ["session", sessionId] as const;
  const etat = useLiveQuery<EtatSessionDirect>(cle, `/api/direct/sessions/${sessionId}`);
  const client = useQueryClient();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [badge, setBadge] = useState<{ jeton: string; nom: string } | null>(null);
  const [forcage, setForcage] = useState<{ classeId: string; motif: string } | null>(null);
  const [choixMembre, setChoixMembre] = useState<Record<string, string>>({});
  const [enCours, demarrer] = useTransition();

  const agir = (fn: () => Promise<{ ok: true } | { ok: false; erreur: string }>, succes: string) =>
    demarrer(async () => {
      setMessage(null);
      const resultat = await appelerAction(fn);
      if (!resultat.ok) {
        setMessage({ ok: false, texte: resultat.erreur });
        return;
      }
      setMessage({ ok: true, texte: succes });
      await client.invalidateQueries({ queryKey: cle });
    });

  const rejoindre = (
    classe: Classe,
    arrivee: Omit<Arrivee, "sessionId" | "classeId">,
    succes: string,
  ) => agir(() => rejoindreUneClasse({ sessionId, classeId: classe.classeId, ...arrivee }), succes);

  if (etat.isPending) return <p className="m-0 text-texte-doux">Chargement des classes…</p>;
  if (etat.isError && !etat.data) {
    return (
      <MessageErreur>
        Les classes ne se chargent pas. Vérifiez la connexion : la page se met à jour dès son
        retour.
      </MessageErreur>
    );
  }
  const { classes, maClasse, statut } = etat.data!;

  return (
    <div className="grid gap-4">
      {etat.isError ? (
        <p role="alert" className="m-0 font-bold text-alerte">
          Hors connexion : ces informations ne sont plus à jour.
        </p>
      ) : null}
      {message ? (
        message.ok ? (
          <MessageSucces>{message.texte}</MessageSucces>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}
      {statut !== "OUVERTE" ? (
        <p className="m-0 text-texte-doux">Cette session n&apos;est plus ouverte.</p>
      ) : (
        <>
          <Scanner
            libelle="Scannez un badge moniteur"
            avecCamera
            onScan={(jeton) =>
              demarrer(async () => {
                setMessage(null);
                const resultat = await appelerAction(() => identifierBadge(jeton));
                if (!resultat.ok) {
                  setBadge(null);
                  setMessage({ ok: false, texte: resultat.erreur });
                  return;
                }
                setBadge({ jeton, nom: resultat.donnees.nom });
              })
            }
          />
          {badge ? (
            <p role="status" className="m-0 rounded-md bg-bleu-voile px-5 py-4 font-bold text-nuit">
              Badge de {badge.nom} : choisissez sa classe.{" "}
              <Button variant="lien" type="button" onClick={() => setBadge(null)}>
                Annuler
              </Button>
            </p>
          ) : null}
          <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2">
            {classes.map((classe) => (
              <li key={classe.classeId}>
                <NotchCard
                  couleur="blanc"
                  aria-label={`Classe ${classe.nom}`}
                  aria-describedby={`etat-${sessionId}-${classe.classeId}`}
                  className={classe.sousMinimum ? "ring-3 ring-alerte" : undefined}
                >
                  <div className="grid gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="m-0 font-display text-h3 font-semibold">{classe.nom}</h3>
                      <Etat classe={classe} id={`etat-${sessionId}-${classe.classeId}`} />
                    </div>
                    {classe.salle ? (
                      <p className="m-0 text-texte-doux">Salle {classe.salle}</p>
                    ) : null}
                    {responsable && classe.motifForcage ? (
                      <p className="m-0 text-label text-texte-doux">
                        Motif du forçage : {classe.motifForcage}
                      </p>
                    ) : null}
                    {classe.sansMoniteur ? (
                      <p className="m-0 flex gap-2 font-bold text-alerte">
                        <TriangleAlert aria-hidden className="size-5 shrink-0" />
                        Aucun moniteur : envoyez quelqu&apos;un dans cette classe tout de suite.
                      </p>
                    ) : classe.sousMinimum ? (
                      <p className="m-0 flex gap-2 font-bold text-alerte">
                        <TriangleAlert aria-hidden className="size-5 shrink-0" />
                        Il manque un moniteur : prévenez le responsable.
                      </p>
                    ) : null}
                    <ul
                      className="m-0 grid list-none gap-2 p-0"
                      aria-label={`Moniteurs de ${classe.nom}`}
                    >
                      {classe.moniteurs.length === 0 ? (
                        <li className="text-texte-doux">Aucun moniteur pour l&apos;instant.</li>
                      ) : (
                        classe.moniteurs.map((m) => (
                          <li key={m.membreId} className="flex flex-wrap items-center gap-3">
                            <span className="font-bold">{m.nom}</span>
                            {m.renfort ? (
                              <span className="text-label text-texte-doux">renfort</span>
                            ) : null}
                            {responsable ? (
                              <Button
                                type="button"
                                variant="lien"
                                disabled={enCours}
                                onClick={() =>
                                  agir(
                                    () => quitterLaClasse(m.membreId),
                                    `${m.nom} a quitté la classe.`,
                                  )
                                }
                              >
                                Faire sortir
                              </Button>
                            ) : null}
                          </li>
                        ))
                      )}
                    </ul>
                    <div className="flex flex-wrap gap-3">
                      {badge ? (
                        <Button
                          type="button"
                          disabled={enCours}
                          onClick={() => {
                            rejoindre(
                              classe,
                              { jeton: badge.jeton },
                              `${badge.nom} a rejoint ${classe.nom}.`,
                            );
                            setBadge(null);
                          }}
                        >
                          <LogIn aria-hidden />
                          Affecter {badge.nom}
                        </Button>
                      ) : maClasse === classe.classeId ? (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={enCours}
                          onClick={() =>
                            agir(() => quitterLaClasse(), `Vous avez quitté ${classe.nom}.`)
                          }
                        >
                          <LogOut aria-hidden />
                          Quitter la classe
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={enCours}
                          onClick={() => rejoindre(classe, {}, `Vous avez rejoint ${classe.nom}.`)}
                        >
                          <LogIn aria-hidden />
                          Rejoindre la classe
                        </Button>
                      )}
                      {peutForcer && !classe.ouverte && forcage?.classeId !== classe.classeId ? (
                        <Button
                          type="button"
                          variant="soleil"
                          onClick={() => setForcage({ classeId: classe.classeId, motif: "" })}
                        >
                          Forcer l&apos;ouverture
                        </Button>
                      ) : null}
                    </div>
                    {forcage?.classeId === classe.classeId ? (
                      <form
                        className="grid gap-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          agir(
                            () => forcerLOuverture(sessionId, classe.classeId, forcage.motif),
                            `${classe.nom} est ouverte, en alerte sur les tableaux de bord.`,
                          );
                          setForcage(null);
                        }}
                      >
                        <Champ
                          id={`motif-${classe.classeId}`}
                          libelle="Motif de l'ouverture forcée"
                          value={forcage.motif}
                          maxLength={200}
                          onChange={(e) => setForcage({ ...forcage, motif: e.target.value })}
                        />
                        <div className="flex flex-wrap gap-3">
                          <Button type="submit" variant="soleil" disabled={enCours}>
                            Confirmer l&apos;ouverture forcée
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => setForcage(null)}>
                            Annuler
                          </Button>
                        </div>
                      </form>
                    ) : null}
                    {responsable && membres.length > 0 ? (
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="grid flex-1 gap-2">
                          <label
                            htmlFor={`membre-${classe.classeId}`}
                            className="text-label font-bold"
                          >
                            Ajouter un moniteur
                          </label>
                          <select
                            id={`membre-${classe.classeId}`}
                            value={choixMembre[classe.classeId] ?? ""}
                            onChange={(e) =>
                              setChoixMembre({ ...choixMembre, [classe.classeId]: e.target.value })
                            }
                            className="min-h-touch rounded-md bg-blanc px-5 text-body-lg shadow-[inset_0_0_0_2px_var(--color-ligne)]"
                          >
                            <option value="">Choisissez une personne</option>
                            {optionsAjout(membres, classes, classe.classeId).map((o) => (
                              <option key={o.membreId} value={o.membreId}>
                                {o.libelle}
                              </option>
                            ))}
                          </select>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={enCours || !choixMembre[classe.classeId]}
                          onClick={() => {
                            const choisi = membres.find(
                              (m) => m.membreId === choixMembre[classe.classeId],
                            );
                            if (!choisi) return;
                            setChoixMembre({ ...choixMembre, [classe.classeId]: "" });
                            rejoindre(
                              classe,
                              { membreId: choisi.membreId, renfort: !choisi.moniteur },
                              `${choisi.nom} a rejoint ${classe.nom}.`,
                            );
                          }}
                        >
                          <UserPlus aria-hidden />
                          Ajouter
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </NotchCard>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

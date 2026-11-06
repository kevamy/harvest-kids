"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { KeyRound, Link2, UserPlus } from "lucide-react";
import { NotchCard } from "@/components/hk/notch-card";
import { Pastille } from "@/components/hk/status-pill";
import { Button } from "@/components/ui/button";
import { Champ, MessageErreur } from "@/components/ui/champ";
import { LienUnique } from "@/components/ui/lien-unique";
import { ModaleConfirmation } from "@/components/ui/modale-confirmation";
import type { Role } from "@/generated/prisma/enums";
import { RESEAU_INDISPONIBLE } from "@/lib/appel-action";
import { LIBELLES_ROLES, ROLES_COMPTE } from "@/lib/roles";
import type { EtatCompte } from "@/server/plateforme/comptes-eglise";
import { MessageSucces } from "../entete";
import { ajouter, modifier, nouveauLien, reinitialiser } from "./actions";

export type CompteVue = {
  membreId: string;
  nom: string;
  identifiant: string;
  roles: Role[];
  etat: EtatCompte;
  soi: boolean;
};

const ETATS: Record<EtatCompte, { libelle: string; classes: string }> = {
  actif: { libelle: "Actif", classes: "text-succes" },
  en_attente: { libelle: "En attente d'activation", classes: "text-nuit" },
  reinitialisation: { libelle: "Mot de passe à redéfinir", classes: "text-nuit" },
  lien_expire: { libelle: "Lien expiré", classes: "text-alerte" },
  desactive: { libelle: "Désactivé", classes: "text-texte-doux" },
};

type Lien = { titre: string; lien: string; validite: string };
type Confirmation = { type: "reinitialiser" | "desactiver"; compte: CompteVue };
type Resultat<T> = { ok: true; donnees: T } | { ok: false; erreur: string };

async function appeler<T>(action: () => Promise<Resultat<T>>): Promise<Resultat<T>> {
  try {
    return await action();
  } catch {
    return { ok: false, erreur: RESEAU_INDISPONIBLE };
  }
}

function CasesRoles({
  prefixe,
  roles,
  onChange,
}: {
  prefixe: string;
  roles: Role[];
  onChange: (roles: Role[]) => void;
}) {
  return (
    <fieldset className="m-0 flex flex-wrap gap-x-6 gap-y-1 border-0 p-0">
      <legend className="mb-1 text-label font-bold">Rôles</legend>
      {ROLES_COMPTE.map((role) => (
        <label key={role} className="flex min-h-touch items-center gap-3">
          <input
            type="checkbox"
            id={`${prefixe}-${role}`}
            className="size-6 accent-bleu"
            checked={roles.includes(role)}
            onChange={(e) =>
              onChange(e.target.checked ? [...roles, role] : roles.filter((r) => r !== role))
            }
          />
          {LIBELLES_ROLES[role]}
        </label>
      ))}
    </fieldset>
  );
}

/** Paramètres › Comptes (cahier §7.10, ADR 0014). Every check is done again on the server. */
export function Comptes({ comptes }: { comptes: CompteVue[] }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [lien, setLien] = useState<Lien | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [edition, setEdition] = useState<{ membreId: string; roles: Role[] } | null>(null);
  const [nouveau, setNouveau] = useState({ nom: "", identifiant: "", roles: [] as Role[] });

  const executer = <T,>(action: () => Promise<Resultat<T>>, succes: (donnees: T) => void) =>
    demarrer(async () => {
      setMessage(null);
      const resultat = await appeler(action);
      if (!resultat.ok) {
        setMessage({ ok: false, texte: resultat.erreur });
        return;
      }
      succes(resultat.donnees);
      router.refresh();
    });

  const confirmer = () => {
    if (!confirmation) return;
    const { type, compte } = confirmation;
    if (type === "reinitialiser") {
      executer(
        () => reinitialiser(compte.membreId),
        ({ lien }) => {
          setConfirmation(null);
          setMessage({ ok: true, texte: `Mot de passe de ${compte.nom} réinitialisé.` });
          setLien({
            titre: `Lien de réinitialisation de ${compte.nom}`,
            lien,
            validite: "24 heures",
          });
        },
      );
    } else {
      executer(
        () => modifier(compte.membreId, { actif: false }),
        () => {
          setConfirmation(null);
          setMessage({ ok: true, texte: `Compte de ${compte.nom} désactivé.` });
        },
      );
    }
  };

  return (
    <div className="grid gap-6">
      {message ? (
        message.ok ? (
          <MessageSucces>{message.texte}</MessageSucces>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}
      {lien ? <LienUnique {...lien} onFermer={() => setLien(null)} /> : null}

      <NotchCard couleur="blanc">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            executer(
              () => ajouter(nouveau),
              (resultat) => {
                if (resultat.statut === "cree") {
                  setMessage({ ok: true, texte: `Compte de ${nouveau.nom} ajouté.` });
                  setLien({
                    titre: `Lien d'activation de ${nouveau.nom}`,
                    lien: resultat.lien,
                    validite: "7 jours",
                  });
                } else {
                  setLien(null);
                  setMessage({ ok: true, texte: "Compte rattaché." });
                }
                setNouveau({ nom: "", identifiant: "", roles: [] });
              },
            );
          }}
        >
          <h2 className="m-0 font-display text-h2 font-semibold">Ajouter un compte</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Champ
              id="nouveau-nom"
              libelle="Nom et prénom"
              value={nouveau.nom}
              onChange={(e) => setNouveau((n) => ({ ...n, nom: e.target.value }))}
            />
            <Champ
              id="nouveau-identifiant"
              libelle="E-mail ou téléphone"
              aide="Celui avec lequel la personne se connectera."
              autoCapitalize="off"
              value={nouveau.identifiant}
              onChange={(e) => setNouveau((n) => ({ ...n, identifiant: e.target.value }))}
            />
          </div>
          <CasesRoles
            prefixe="nouveau"
            roles={nouveau.roles}
            onChange={(roles) => setNouveau((n) => ({ ...n, roles }))}
          />
          <Button type="submit" variant="bleu" className="justify-self-start" disabled={enCours}>
            <UserPlus aria-hidden />
            Ajouter le compte
          </Button>
        </form>
      </NotchCard>

      <NotchCard couleur="blanc">
        <h2 className="m-0 mb-4 font-display text-h2 font-semibold">Comptes de l&apos;église</h2>
        <ul className="m-0 grid list-none gap-4 p-0" aria-label="Comptes de l'église">
          {comptes.map((c) => (
            <li
              key={c.membreId}
              aria-label={c.nom}
              className="grid gap-3 rounded-md px-5 py-4 shadow-[inset_0_0_0_2px_var(--color-ligne)]"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-bold">
                  {c.nom}
                  {c.soi ? " (vous)" : ""}
                </span>
                <span className="text-texte-doux">{c.identifiant}</span>
                <Pastille className={ETATS[c.etat].classes}>{ETATS[c.etat].libelle}</Pastille>
              </div>
              {edition?.membreId === c.membreId ? (
                <div className="grid gap-3">
                  <CasesRoles
                    prefixe={c.membreId}
                    roles={edition.roles}
                    onChange={(roles) => setEdition({ membreId: c.membreId, roles })}
                  />
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="bleu"
                      disabled={enCours}
                      onClick={() =>
                        executer(
                          () => modifier(c.membreId, { roles: edition.roles }),
                          () => {
                            setEdition(null);
                            setMessage({ ok: true, texte: `Rôles de ${c.nom} enregistrés.` });
                          },
                        )
                      }
                    >
                      Enregistrer les rôles
                    </Button>
                    <Button variant="ghost" disabled={enCours} onClick={() => setEdition(null)}>
                      Annuler
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="m-0">{c.roles.map((r) => LIBELLES_ROLES[r]).join(", ")}</p>
              )}
              <div className="flex flex-wrap gap-3">
                {edition?.membreId !== c.membreId && c.etat !== "desactive" ? (
                  <Button
                    variant="ghost"
                    onClick={() => setEdition({ membreId: c.membreId, roles: c.roles })}
                  >
                    Modifier les rôles
                  </Button>
                ) : null}
                {c.etat === "en_attente" || c.etat === "lien_expire" ? (
                  <Button
                    variant="ghost"
                    disabled={enCours}
                    onClick={() =>
                      executer(
                        () => nouveauLien(c.membreId),
                        ({ lien }) => {
                          setMessage({ ok: true, texte: `Nouveau lien de ${c.nom} généré.` });
                          setLien({
                            titre: `Lien d'activation de ${c.nom}`,
                            lien,
                            validite: "7 jours",
                          });
                        },
                      )
                    }
                  >
                    <Link2 aria-hidden />
                    Générer un nouveau lien
                  </Button>
                ) : null}
                {c.etat === "actif" || c.etat === "reinitialisation" ? (
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmation({ type: "reinitialiser", compte: c })}
                  >
                    <KeyRound aria-hidden />
                    Réinitialiser le mot de passe
                  </Button>
                ) : null}
                {c.etat === "desactive" ? (
                  <Button
                    variant="ghost"
                    disabled={enCours}
                    onClick={() =>
                      executer(
                        () => modifier(c.membreId, { actif: true }),
                        () => setMessage({ ok: true, texte: `Compte de ${c.nom} réactivé.` }),
                      )
                    }
                  >
                    Réactiver le compte
                  </Button>
                ) : c.soi ? null : (
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmation({ type: "desactiver", compte: c })}
                  >
                    Désactiver le compte
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </NotchCard>

      <ModaleConfirmation
        ouverte={confirmation !== null}
        titre={
          confirmation?.type === "reinitialiser"
            ? `Réinitialiser le mot de passe de ${confirmation.compte.nom} ?`
            : `Désactiver le compte de ${confirmation?.compte.nom ?? ""} ?`
        }
        libelleConfirmer={
          confirmation?.type === "reinitialiser"
            ? "Réinitialiser le mot de passe"
            : "Désactiver le compte"
        }
        enCours={enCours}
        onConfirmer={confirmer}
        onAnnuler={() => setConfirmation(null)}
      >
        {confirmation?.type === "reinitialiser" ? (
          <>
            <p className="m-0">
              Son mot de passe actuel est effacé et ses sessions sont fermées{" "}
              <strong>tout de suite</strong> : il ne pourra plus se connecter avant d&apos;avoir
              choisi un nouveau mot de passe.
            </p>
            <p className="m-0">Vous recevrez un lien valable 24 heures à lui transmettre.</p>
          </>
        ) : (
          <p className="m-0">
            Il n&apos;aura plus accès à votre église, tout de suite, et son badge moniteur sera
            révoqué. Vous pourrez réactiver le compte plus tard.
          </p>
        )}
      </ModaleConfirmation>
    </div>
  );
}

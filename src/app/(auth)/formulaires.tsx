"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Champ, MessageErreur } from "@/components/ui/champ";
import { usePret } from "@/lib/use-pret";
import { schemaConnexion, schemaDefinitionPin } from "@/lib/schemas/auth";
import { choisirEglise, definirMonPin, seConnecter, type Resultat } from "./actions";

const RESEAU_INDISPONIBLE =
  "Le serveur ne répond pas. Vérifiez le Wi-Fi ou la 4G de la tablette, puis réessayez.";

/** Calls a Server Action; a network failure is reported, never shown as success. */
async function appeler(action: () => Promise<Resultat>): Promise<Resultat> {
  try {
    return await action();
  } catch {
    return { ok: false, erreur: RESEAU_INDISPONIBLE };
  }
}

export function FormulaireConnexion() {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const formulaire = useForm<z.infer<typeof schemaConnexion>>({
    resolver: zodResolver(schemaConnexion),
    defaultValues: { identifiant: "", motDePasse: "" },
  });
  const { errors, isSubmitting } = formulaire.formState;
  const pret = usePret();

  return (
    <form
      method="post"
      noValidate
      className="grid gap-5"
      onSubmit={formulaire.handleSubmit(async (valeurs) => {
        setErreur(null);
        const resultat = await appeler(() => seConnecter(valeurs));
        if (!resultat.ok) {
          setErreur(resultat.erreur);
          return;
        }
        router.replace("/");
        router.refresh();
      })}
    >
      {erreur ? <MessageErreur>{erreur}</MessageErreur> : null}
      <Champ
        id="identifiant"
        libelle="E-mail ou téléphone"
        autoComplete="username"
        autoCapitalize="off"
        erreur={errors.identifiant?.message}
        {...formulaire.register("identifiant")}
      />
      <Champ
        id="motDePasse"
        libelle="Mot de passe"
        type="password"
        autoComplete="current-password"
        erreur={errors.motDePasse?.message}
        {...formulaire.register("motDePasse")}
      />
      <Button type="submit" variant="bleu" size="xl" disabled={!pret || isSubmitting}>
        {isSubmitting ? "Connexion en cours…" : "Se connecter"}
      </Button>
    </form>
  );
}

export function ListeEglises({ eglises }: { eglises: { id: string; nom: string }[] }) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  return (
    <div className="grid gap-4">
      {erreur ? <MessageErreur>{erreur}</MessageErreur> : null}
      <ul className="grid gap-3">
        {eglises.map((eglise) => (
          <li key={eglise.id}>
            <Button
              variant="ghost"
              size="xl"
              className="w-full justify-start bg-blanc"
              disabled={enCours}
              onClick={() =>
                demarrer(async () => {
                  setErreur(null);
                  const resultat = await appeler(() => choisirEglise(eglise.id));
                  if (!resultat.ok) {
                    setErreur(resultat.erreur);
                    return;
                  }
                  router.replace("/accueil");
                  router.refresh();
                })
              }
            >
              {eglise.nom}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FormulaireDefinitionPin() {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const formulaire = useForm<z.infer<typeof schemaDefinitionPin>>({
    resolver: zodResolver(schemaDefinitionPin),
    defaultValues: { pin: "", confirmation: "" },
  });
  const { errors, isSubmitting } = formulaire.formState;
  const pret = usePret();
  const proprietesPin = {
    type: "password",
    inputMode: "numeric",
    autoComplete: "off",
    maxLength: 6,
  } as const;

  return (
    <form
      method="post"
      noValidate
      className="grid gap-5"
      onSubmit={formulaire.handleSubmit(async (valeurs) => {
        setErreur(null);
        const resultat = await appeler(() => definirMonPin(valeurs));
        if (!resultat.ok) {
          setErreur(resultat.erreur);
          return;
        }
        router.replace("/accueil");
        router.refresh();
      })}
    >
      {erreur ? <MessageErreur>{erreur}</MessageErreur> : null}
      <Champ
        id="pin"
        libelle="Nouveau code PIN (6 chiffres)"
        erreur={errors.pin?.message}
        {...proprietesPin}
        {...formulaire.register("pin")}
      />
      <Champ
        id="confirmation"
        libelle="Confirmez le code PIN"
        erreur={errors.confirmation?.message}
        {...proprietesPin}
        {...formulaire.register("confirmation")}
      />
      <Button type="submit" variant="bleu" size="xl" disabled={!pret || isSubmitting}>
        Enregistrer le code PIN
      </Button>
    </form>
  );
}

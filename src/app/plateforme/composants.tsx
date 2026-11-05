"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Champ, MessageErreur } from "@/components/ui/champ";
import { LienUnique } from "@/components/ui/lien-unique";
import { usePret } from "@/lib/use-pret";
import {
  changerStatut,
  creerNouvelleEglise,
  type ResultatCreationEglise,
  type ResultatPlateforme,
} from "./actions";

const RESEAU_INDISPONIBLE = "Le serveur ne répond pas. Vérifiez la connexion, puis réessayez.";

async function appeler(action: () => Promise<ResultatPlateforme>): Promise<ResultatPlateforme> {
  try {
    return await action();
  } catch {
    return { ok: false, erreur: RESEAU_INDISPONIBLE };
  }
}

export function BoutonStatut({
  egliseId,
  statut,
  nom,
}: {
  egliseId: string;
  statut: "ACTIVE" | "SUSPENDUE";
  nom: string;
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const suspendre = statut === "ACTIVE";

  return (
    <div className="grid gap-2">
      {erreur ? <MessageErreur>{erreur}</MessageErreur> : null}
      <Button
        variant={suspendre ? "ghost" : "bleu"}
        disabled={enCours}
        aria-label={`${suspendre ? "Suspendre" : "Réactiver"} ${nom}`}
        onClick={() =>
          demarrer(async () => {
            setErreur(null);
            const resultat = await appeler(() =>
              changerStatut(egliseId, suspendre ? "SUSPENDUE" : "ACTIVE"),
            );
            if (!resultat.ok) setErreur(resultat.erreur);
          })
        }
      >
        {suspendre ? "Suspendre l'église" : "Réactiver l'église"}
      </Button>
    </div>
  );
}

// Same rules as the server (schemaNouvelleEglise), flattened for the form.
const schemaFormulaire = z.object({
  nom: z.string().trim().min(3, "Le nom compte au moins 3 caractères."),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lettres minuscules, chiffres et tirets seulement."),
  fuseau: z.string().min(1),
  adminNom: z.string().trim().min(2, "Saisissez le nom de l'administrateur."),
  adminEmail: z.email("Saisissez une adresse e-mail valide."),
});
type Formulaire = z.infer<typeof schemaFormulaire>;

function versSlug(nom: string) {
  return nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function FormulaireNouvelleEglise({ fuseaux }: { fuseaux: readonly string[] }) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [lien, setLien] = useState<string | null>(null);
  const formulaire = useForm<Formulaire>({
    resolver: zodResolver(schemaFormulaire),
    defaultValues: {
      nom: "",
      slug: "",
      fuseau: "Africa/Porto-Novo",
      adminNom: "",
      adminEmail: "",
    },
  });
  const { errors, isSubmitting } = formulaire.formState;
  const pret = usePret();
  const terminer = () => {
    router.replace("/plateforme");
    router.refresh();
  };

  if (lien) {
    return (
      <div className="grid gap-4">
        <p role="status" className="m-0 font-bold">
          Église créée.
        </p>
        <LienUnique
          titre="Lien d'activation du premier administrateur"
          lien={lien}
          validite="7 jours"
          onFermer={terminer}
        />
      </div>
    );
  }

  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={formulaire.handleSubmit(async (v) => {
        setErreur(null);
        let resultat: ResultatCreationEglise;
        try {
          resultat = await creerNouvelleEglise({
            nom: v.nom,
            slug: v.slug,
            fuseau: v.fuseau,
            admin: { nom: v.adminNom, email: v.adminEmail },
          });
        } catch {
          resultat = { ok: false, erreur: RESEAU_INDISPONIBLE };
        }
        if (!resultat.ok) {
          setErreur(resultat.erreur);
          return;
        }
        if (resultat.lien) setLien(resultat.lien);
        else terminer();
      })}
    >
      {erreur ? <MessageErreur>{erreur}</MessageErreur> : null}
      <Champ
        id="nom"
        libelle="Nom de l'église"
        erreur={errors.nom?.message}
        {...formulaire.register("nom", {
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            if (!formulaire.getFieldState("slug").isDirty) {
              formulaire.setValue("slug", versSlug(e.target.value));
            }
          },
        })}
      />
      <Champ
        id="slug"
        libelle="Adresse courte (écran d'appel)"
        aide="Utilisée dans l'adresse de l'écran d'appel : /ecran/adresse-courte."
        erreur={errors.slug?.message}
        {...formulaire.register("slug")}
      />
      <div className="grid gap-2">
        <label htmlFor="fuseau" className="text-label font-bold">
          Fuseau horaire
        </label>
        <select
          id="fuseau"
          className="min-h-touch rounded-md bg-blanc px-5 text-body-lg shadow-[inset_0_0_0_2px_var(--color-ligne)]"
          {...formulaire.register("fuseau")}
        >
          {fuseaux.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <h2 className="mt-4 mb-0 font-display text-h3 font-semibold">Premier administrateur</h2>
      <Champ
        id="adminNom"
        libelle="Nom"
        erreur={errors.adminNom?.message}
        {...formulaire.register("adminNom")}
      />
      <Champ
        id="adminEmail"
        libelle="E-mail"
        type="email"
        autoCapitalize="off"
        aide="Un nouveau compte reçoit un lien d'activation (7 jours) pour choisir son mot de passe. Un compte qui existe déjà dans une autre église est simplement rattaché à celle-ci."
        erreur={errors.adminEmail?.message}
        {...formulaire.register("adminEmail")}
      />
      <Button type="submit" variant="bleu" size="xl" disabled={!pret || isSubmitting}>
        Créer l&apos;église
      </Button>
    </form>
  );
}

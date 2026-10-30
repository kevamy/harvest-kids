"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Champ, MessageErreur } from "@/components/ui/champ";
import { appelerAction } from "@/lib/appel-action";
import { MessageSucces } from "../entete";
import { enregistrerProfil, supprimerLogoClair, televerserLogo } from "../actions";

// Same rules as the server (schemaProfilEglise); the server checks again.
const schemaFormulaire = z.object({
  nom: z.string().trim().min(3, "Le nom compte au moins 3 caractères."),
  adresse: z.string().trim().max(200, "200 caractères au plus."),
  telephoneAccueil: z
    .string()
    .trim()
    .refine((s) => s === "" || /^\+?[0-9 ().-]{6,20}$/.test(s), {
      message: "Saisissez un numéro de téléphone valide, par exemple +229 01 23 45 67.",
    }),
  fuseau: z.string().min(1),
});
type Formulaire = z.infer<typeof schemaFormulaire>;

export function FormulaireProfil({
  fuseaux,
  valeurs,
}: {
  fuseaux: readonly string[];
  valeurs: Formulaire;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const formulaire = useForm<Formulaire>({
    resolver: zodResolver(schemaFormulaire),
    defaultValues: valeurs,
  });
  const { errors, isSubmitting } = formulaire.formState;

  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={formulaire.handleSubmit(async (v) => {
        setMessage(null);
        const resultat = await appelerAction(() => enregistrerProfil(v));
        if (!resultat.ok) {
          setMessage({ ok: false, texte: resultat.erreur });
          return;
        }
        setMessage({ ok: true, texte: "Profil enregistré." });
        formulaire.reset(v);
        router.refresh();
      })}
    >
      {message ? (
        message.ok ? (
          <MessageSucces>{message.texte}</MessageSucces>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}
      <Champ
        id="nom"
        libelle="Nom de l'église"
        erreur={errors.nom?.message}
        {...formulaire.register("nom")}
      />
      <Champ
        id="adresse"
        libelle="Adresse"
        erreur={errors.adresse?.message}
        {...formulaire.register("adresse")}
      />
      <Champ
        id="telephoneAccueil"
        libelle="Téléphone de l'accueil enfants"
        type="tel"
        aide="Imprimé sur les cartes famille."
        erreur={errors.telephoneAccueil?.message}
        {...formulaire.register("telephoneAccueil")}
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
      <Button type="submit" variant="bleu" disabled={isSubmitting} className="justify-self-start">
        Enregistrer le profil
      </Button>
    </form>
  );
}

export function FormulaireLogo({
  variante,
  cle,
  nomEglise,
}: {
  variante: "principal" | "clair";
  cle: string | null;
  nomEglise: string;
}) {
  const router = useRouter();
  const champ = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();
  const id = `logo-${variante}`;
  const libelle = variante === "principal" ? "logo" : "logo clair";

  const envoyer = (donnees: FormData) =>
    demarrer(async () => {
      setMessage(null);
      const resultat = await appelerAction(() => televerserLogo(donnees));
      if (!resultat.ok) {
        setMessage({ ok: false, texte: resultat.erreur });
        return;
      }
      setMessage({ ok: true, texte: "Logo enregistré." });
      if (champ.current) champ.current.value = "";
      router.refresh();
    });

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        envoyer(new FormData(event.currentTarget));
      }}
    >
      {message ? (
        message.ok ? (
          <MessageSucces>{message.texte}</MessageSucces>
        ) : (
          <MessageErreur>{message.texte}</MessageErreur>
        )
      ) : null}
      <div
        className={
          variante === "clair"
            ? "grid min-h-32 place-items-center rounded-md bg-nuit p-4"
            : "grid min-h-32 place-items-center rounded-md bg-creme p-4"
        }
      >
        {cle ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated route, not optimisable
          <img
            src={`/api/fichiers/${cle}`}
            alt={`${variante === "principal" ? "Logo" : "Logo clair"} de ${nomEglise}`}
            className="max-h-28 w-auto"
          />
        ) : (
          <p className={variante === "clair" ? "m-0 text-blanc" : "m-0 text-texte-doux"}>
            Aucun {libelle} pour l&apos;instant.
          </p>
        )}
      </div>
      <input type="hidden" name="variante" value={variante} />
      <div className="grid gap-2">
        <label htmlFor={id} className="text-label font-bold">
          Fichier PNG ou SVG (2 Mo au plus)
        </label>
        <input
          ref={champ}
          id={id}
          name="logo"
          type="file"
          accept="image/png,image/svg+xml"
          required
          className="min-h-touch text-body"
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="bleu" disabled={enCours}>
          Enregistrer le {libelle}
        </Button>
        {variante === "clair" && cle ? (
          <Button
            type="button"
            variant="ghost"
            disabled={enCours}
            onClick={() =>
              demarrer(async () => {
                setMessage(null);
                const resultat = await appelerAction(() => supprimerLogoClair());
                if (!resultat.ok) {
                  setMessage({ ok: false, texte: resultat.erreur });
                  return;
                }
                setMessage({ ok: true, texte: "Logo clair supprimé." });
                router.refresh();
              })
            }
          >
            Supprimer le logo clair
          </Button>
        ) : null}
      </div>
    </form>
  );
}

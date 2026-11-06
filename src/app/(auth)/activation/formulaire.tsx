"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Champ, MessageErreur } from "@/components/ui/champ";
import { RESEAU_INDISPONIBLE } from "@/lib/appel-action";
import { usePret } from "@/lib/use-pret";
import { MessageSucces } from "../../(app)/parametres/entete";
import { activer, type ResultatActivation } from "./actions";

/**
 * Reads the token from the URL fragment, then removes it from the address bar and the
 * history. The password is sent by POST only (Server Action). A link pasted again in the
 * same tab only changes the fragment (no page load): the form starts over on `hashchange`.
 */
export function FormulaireActivation() {
  const pret = usePret();
  const [jeton, setJeton] = useState<string | null>(null);
  const [lu, setLu] = useState(false);
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState<ResultatActivation | null>(null);

  useEffect(() => {
    // Reading the fragment needs the browser: it is never sent to the server.
    const lireLeLien = () => {
      const fragment = window.location.hash.slice(1);
      if (fragment) window.history.replaceState(null, "", window.location.pathname);
      setJeton(fragment || null);
      setResultat(null);
      setMotDePasse("");
      setConfirmation("");
      setLu(true);
    };
    lireLeLien();
    window.addEventListener("hashchange", lireLeLien);
    return () => window.removeEventListener("hashchange", lireLeLien);
  }, []);

  if (resultat?.ok) {
    return (
      <div className="grid gap-5">
        <MessageSucces>
          Mot de passe enregistré. Vous pouvez maintenant vous connecter.
        </MessageSucces>
        <Button asChild variant="bleu" size="xl">
          <Link href="/connexion">Se connecter</Link>
        </Button>
      </div>
    );
  }
  if (lu && !jeton) {
    return (
      <MessageErreur>
        Ce lien est incomplet. Ouvrez le lien entier reçu de l&apos;administrateur de votre église,
        ou demandez-lui un nouveau lien.
      </MessageErreur>
    );
  }

  return (
    <form
      method="post"
      noValidate
      className="grid gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!jeton) return;
        setEnCours(true);
        setResultat(null);
        try {
          setResultat(await activer({ jeton, motDePasse, confirmation }));
        } catch {
          setResultat({ ok: false, erreur: RESEAU_INDISPONIBLE });
        } finally {
          setEnCours(false);
        }
      }}
    >
      {resultat && !resultat.ok ? <MessageErreur>{resultat.erreur}</MessageErreur> : null}
      <Champ
        id="motDePasse"
        libelle="Nouveau mot de passe"
        type="password"
        autoComplete="new-password"
        aide="10 caractères au moins."
        value={motDePasse}
        onChange={(e) => setMotDePasse(e.target.value)}
      />
      <Champ
        id="confirmation"
        libelle="Confirmez le mot de passe"
        type="password"
        autoComplete="new-password"
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
      />
      <Button type="submit" variant="bleu" size="xl" disabled={!pret || !jeton || enCours}>
        {enCours ? "Enregistrement…" : "Enregistrer mon mot de passe"}
      </Button>
    </form>
  );
}

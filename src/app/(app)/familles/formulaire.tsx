"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { Camera, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Champ, MessageErreur } from "@/components/ui/champ";
import { ChampTelephone } from "@/components/ui/champ-telephone";
import { appelerAction } from "@/lib/appel-action";
import { reduirePhoto } from "@/lib/photo-navigateur";
import { enregistrer } from "./actions";
import {
  nouveauTuteur,
  nouvelAutre,
  nouvelEnfant,
  type Autre,
  type Enfant,
  type Photo,
  type Tuteur,
  type ValeursFamille,
} from "./valeurs";

const CLASSE_SELECT =
  "min-h-touch w-full rounded-md bg-blanc px-5 text-body-lg shadow-[inset_0_0_0_2px_var(--color-ligne)]";

function ChampPhoto({
  libelle,
  photo,
  onChange,
  obligatoire,
}: {
  libelle: string;
  photo: Photo;
  onChange: (photo: Photo) => void;
  obligatoire?: boolean;
}) {
  const id = useId();
  const champ = useRef<HTMLInputElement>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const source = photo && "cle" in photo ? `/api/fichiers/${photo.cle}` : photo?.apercu;

  return (
    <div className="grid gap-2">
      <span className="text-label font-bold">
        {libelle}
        {obligatoire ? " (obligatoire)" : " (facultative)"}
      </span>
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-md bg-creme">
          {source ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview or authenticated route
            <img src={source} alt={libelle} className="size-full object-cover" />
          ) : (
            <Camera aria-hidden className="size-8 text-texte-doux" />
          )}
        </div>
        <div className="grid gap-2">
          <label
            htmlFor={id}
            className="inline-flex min-h-touch cursor-pointer items-center gap-2 rounded-pill bg-blanc px-6 font-bold text-nuit shadow-[inset_0_0_0_2px_var(--color-nuit)]"
          >
            <Camera aria-hidden className="size-5" />
            {photo ? "Reprendre la photo" : "Prendre la photo"}
          </label>
          <input
            ref={champ}
            id={id}
            type="file"
            accept="image/*"
            capture="environment"
            aria-label={libelle}
            className="sr-only"
            onChange={async (event) => {
              const fichier = event.target.files?.[0];
              if (!fichier) return;
              setErreur(null);
              try {
                const nouvelle = await reduirePhoto(fichier);
                onChange({ nouvelle, apercu: URL.createObjectURL(nouvelle) });
              } catch {
                setErreur("Cette photo n'est pas lisible. Reprenez la photo.");
              } finally {
                if (champ.current) champ.current.value = "";
              }
            }}
          />
          {photo && !obligatoire ? (
            <Button type="button" variant="lien" onClick={() => onChange(null)}>
              Retirer la photo
            </Button>
          ) : null}
        </div>
      </div>
      {erreur ? <p className="m-0 text-label font-bold text-alerte">{erreur}</p> : null}
    </div>
  );
}

function Bloc({
  titre,
  children,
  action,
}: {
  titre: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section
      aria-label={titre}
      className="grid gap-5 rounded-lg bg-blanc p-6 shadow-[inset_0_0_0_2px_var(--color-ligne)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="m-0 font-display text-h3 font-semibold">{titre}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Family form (cahier §7.1): registration, edition, or finalisation of a draft. The
 * server validates everything again (photos of authorised adults, consents, ages).
 */
export function FormulaireFamille({
  valeursInitiales,
  familleId,
  libelleBouton,
  alertes,
  indicatif,
}: {
  valeursInitiales: ValeursFamille;
  familleId?: string;
  libelleBouton: string;
  alertes: readonly { code: string; libelle: string }[];
  /** Church's default country code, for numbers typed without one. */
  indicatif: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<ValeursFamille>(valeursInitiales);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  const majTuteur = (i: number, champ: Partial<Tuteur>) =>
    setV((s) => ({ ...s, tuteurs: s.tuteurs.map((t, j) => (j === i ? { ...t, ...champ } : t)) }));
  const majEnfant = (i: number, champ: Partial<Enfant>) =>
    setV((s) => ({ ...s, enfants: s.enfants.map((e, j) => (j === i ? { ...e, ...champ } : e)) }));
  const majAutre = (i: number, champ: Partial<Autre>) =>
    setV((s) => ({ ...s, autres: s.autres.map((a, j) => (j === i ? { ...a, ...champ } : a)) }));

  const envoyer = () =>
    demarrer(async () => {
      setErreur(null);
      const donnees = new FormData();
      const refPhoto = (photo: Photo, cle: string) => {
        if (!photo) return null;
        if ("cle" in photo) return { conserver: true };
        const champ = `photo-${cle}`;
        donnees.append(champ, new File([photo.nouvelle], `${cle}.jpg`, { type: "image/jpeg" }));
        return { champ };
      };
      const saisie = {
        nom: v.nom,
        notes: v.notes,
        consentementDonnees: v.consentementDonnees,
        consentementPhotos: v.consentementPhotos,
        tuteurs: v.tuteurs.map((t) => ({
          id: t.id,
          prenom: t.prenom,
          nom: t.nom,
          lien: t.lien,
          telephone: t.telephone,
          telephone2: t.telephone2,
          whatsapp: t.whatsapp,
          principal: t.principal,
          autorise: t.autorise,
          photo: t.autorise ? refPhoto(t.photo, t.uid.toLowerCase()) : null,
        })),
        enfants: v.enfants.map((e) => ({
          id: e.id,
          prenom: e.prenom,
          nom: e.nom,
          dateNaissance: e.dateNaissance,
          sexe: e.sexe || null,
          alertes: e.alertes,
          alerteDetail: e.alerteDetail,
          notes: e.notes,
          actif: e.actif,
          photo: v.consentementPhotos ? refPhoto(e.photo, e.uid.toLowerCase()) : null,
        })),
        autres: v.autres.map((a) => ({
          id: a.id,
          prenom: a.prenom,
          nom: a.nom,
          lien: a.lien,
          telephone: a.telephone,
          actif: a.actif,
          photo: a.actif ? refPhoto(a.photo, a.uid.toLowerCase()) : null,
        })),
      };
      donnees.append("donnees", JSON.stringify(saisie));
      if (familleId) donnees.append("familleId", familleId);
      const resultat = await appelerAction(() => enregistrer(donnees));
      if (!resultat.ok) {
        setErreur(resultat.erreur);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      router.push(`/familles/${resultat.familleId}`);
      router.refresh();
    });

  return (
    <form
      noValidate
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        envoyer();
      }}
    >
      {erreur ? <MessageErreur>{erreur}</MessageErreur> : null}

      <Bloc titre="Famille">
        <div className="grid gap-5 md:grid-cols-2">
          <Champ
            id="famille-nom"
            libelle="Nom de la famille"
            value={v.nom}
            onChange={(e) => setV({ ...v, nom: e.target.value })}
          />
          <Champ
            id="famille-notes"
            libelle="Notes (facultatif)"
            value={v.notes}
            onChange={(e) => setV({ ...v, notes: e.target.value })}
          />
        </div>
      </Bloc>

      {v.tuteurs.map((t, i) => (
        <Bloc
          key={t.uid}
          titre={`Tuteur ${i + 1}`}
          action={
            !t.id && v.tuteurs.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setV((s) => {
                    const tuteurs = s.tuteurs.filter((_, j) => j !== i);
                    if (!tuteurs.some((x) => x.principal)) {
                      tuteurs[0] = { ...tuteurs[0]!, principal: true };
                    }
                    return { ...s, tuteurs };
                  })
                }
              >
                <Trash2 aria-hidden />
                Retirer ce tuteur
              </Button>
            ) : null
          }
        >
          <div className="grid gap-5 md:grid-cols-2">
            <Champ
              id={`tuteur-${t.uid}-prenom`}
              libelle={`Prénom du tuteur ${i + 1}`}
              value={t.prenom}
              onChange={(e) => majTuteur(i, { prenom: e.target.value })}
            />
            <Champ
              id={`tuteur-${t.uid}-nom`}
              libelle={`Nom du tuteur ${i + 1}`}
              value={t.nom}
              onChange={(e) => majTuteur(i, { nom: e.target.value })}
            />
            <Champ
              id={`tuteur-${t.uid}-lien`}
              libelle={`Lien du tuteur ${i + 1} avec les enfants`}
              aide="Par exemple : mère, père, tante."
              value={t.lien}
              onChange={(e) => majTuteur(i, { lien: e.target.value })}
            />
            <ChampTelephone
              id={`tuteur-${t.uid}-telephone`}
              libelle={`Téléphone du tuteur ${i + 1}`}
              indicatif={indicatif}
              value={t.telephone}
              onChange={(valeur) => majTuteur(i, { telephone: valeur })}
            />
            <ChampTelephone
              id={`tuteur-${t.uid}-telephone2`}
              libelle={`Second téléphone du tuteur ${i + 1} (facultatif)`}
              indicatif={indicatif}
              value={t.telephone2}
              onChange={(valeur) => majTuteur(i, { telephone2: valeur })}
            />
            <ChampTelephone
              id={`tuteur-${t.uid}-whatsapp`}
              libelle={`WhatsApp du tuteur ${i + 1} (facultatif)`}
              indicatif={indicatif}
              value={t.whatsapp}
              onChange={(valeur) => majTuteur(i, { whatsapp: valeur })}
            />
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex min-h-touch items-center gap-3 font-bold">
              <input
                type="radio"
                name="principal"
                className="size-6 accent-bleu"
                checked={t.principal}
                onChange={() =>
                  setV((s) => ({
                    ...s,
                    tuteurs: s.tuteurs.map((x, j) => ({ ...x, principal: j === i })),
                  }))
                }
              />
              Contact principal
            </label>
            <label className="flex min-h-touch items-center gap-3 font-bold">
              <input
                type="checkbox"
                className="size-6 accent-bleu"
                checked={t.autorise}
                onChange={(e) => majTuteur(i, { autorise: e.target.checked })}
              />
              Autorisé à récupérer les enfants
            </label>
          </div>
          {t.autorise ? (
            <ChampPhoto
              libelle={`Photo du tuteur ${i + 1}`}
              obligatoire
              photo={t.photo}
              onChange={(photo) => majTuteur(i, { photo })}
            />
          ) : null}
        </Bloc>
      ))}
      <Button
        type="button"
        variant="ghost"
        className="justify-self-start"
        disabled={v.tuteurs.length >= 4}
        onClick={() => setV((s) => ({ ...s, tuteurs: [...s.tuteurs, nouveauTuteur(false)] }))}
      >
        <Plus aria-hidden />
        Ajouter un tuteur
      </Button>

      {v.enfants.map((e, i) => (
        <Bloc
          key={e.uid}
          titre={`Enfant ${i + 1}`}
          action={
            !e.id && v.enfants.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setV((s) => ({ ...s, enfants: s.enfants.filter((_, j) => j !== i) }))
                }
              >
                <Trash2 aria-hidden />
                Retirer cet enfant
              </Button>
            ) : null
          }
        >
          <div className="grid gap-5 md:grid-cols-2">
            <Champ
              id={`enfant-${e.uid}-prenom`}
              libelle={`Prénom de l'enfant ${i + 1}`}
              value={e.prenom}
              onChange={(ev) => majEnfant(i, { prenom: ev.target.value })}
            />
            <Champ
              id={`enfant-${e.uid}-nom`}
              libelle={`Nom de l'enfant ${i + 1}`}
              value={e.nom}
              onChange={(ev) => majEnfant(i, { nom: ev.target.value })}
            />
            <Champ
              id={`enfant-${e.uid}-naissance`}
              libelle={`Date de naissance de l'enfant ${i + 1}`}
              type="date"
              value={e.dateNaissance}
              onChange={(ev) => majEnfant(i, { dateNaissance: ev.target.value })}
            />
            <div className="grid gap-2">
              <label htmlFor={`enfant-${e.uid}-sexe`} className="text-label font-bold">
                {`Sexe de l'enfant ${i + 1} (facultatif)`}
              </label>
              <select
                id={`enfant-${e.uid}-sexe`}
                className={CLASSE_SELECT}
                value={e.sexe}
                onChange={(ev) => majEnfant(i, { sexe: ev.target.value as Enfant["sexe"] })}
              >
                <option value="">Non précisé</option>
                <option value="F">Fille</option>
                <option value="M">Garçon</option>
              </select>
            </div>
          </div>
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-1 p-0 text-label font-bold">{`Alertes médicales de l'enfant ${i + 1}`}</legend>
            <div className="flex flex-wrap gap-x-6">
              {alertes.map((a) => (
                <label key={a.code} className="flex min-h-touch items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-6 accent-bleu"
                    checked={e.alertes.includes(a.code)}
                    onChange={(ev) =>
                      majEnfant(i, {
                        alertes: ev.target.checked
                          ? [...e.alertes, a.code]
                          : e.alertes.filter((c) => c !== a.code),
                      })
                    }
                  />
                  {a.libelle}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-5 md:grid-cols-2">
            <Champ
              id={`enfant-${e.uid}-alerte`}
              libelle={`Détail des alertes de l'enfant ${i + 1} (facultatif)`}
              aide="Allergies, traitement, consignes à suivre."
              value={e.alerteDetail}
              onChange={(ev) => majEnfant(i, { alerteDetail: ev.target.value })}
            />
            <Champ
              id={`enfant-${e.uid}-notes`}
              libelle={`Notes sur l'enfant ${i + 1} (facultatif)`}
              value={e.notes}
              onChange={(ev) => majEnfant(i, { notes: ev.target.value })}
            />
          </div>
          {v.consentementPhotos ? (
            <ChampPhoto
              libelle={`Photo de l'enfant ${i + 1}`}
              photo={e.photo}
              onChange={(photo) => majEnfant(i, { photo })}
            />
          ) : (
            <p className="m-0 text-label text-texte-doux">
              Sans le consentement photo du tuteur, aucune photo d&apos;enfant n&apos;est
              enregistrée.
            </p>
          )}
          {e.id ? (
            <label className="flex min-h-touch items-center gap-3 font-bold">
              <input
                type="checkbox"
                className="size-6 accent-bleu"
                checked={!e.actif}
                onChange={(ev) => majEnfant(i, { actif: !ev.target.checked })}
              />
              Ne vient plus (l&apos;enfant reste dans l&apos;historique)
            </label>
          ) : null}
        </Bloc>
      ))}
      <Button
        type="button"
        variant="ghost"
        className="justify-self-start"
        disabled={v.enfants.length >= 12}
        onClick={() => setV((s) => ({ ...s, enfants: [...s.enfants, nouvelEnfant(s.nom)] }))}
      >
        <Plus aria-hidden />
        Ajouter un enfant
      </Button>

      {v.autres.map((a, i) => (
        <Bloc
          key={a.uid}
          titre={`Autre personne autorisée ${i + 1}`}
          action={
            !a.id ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setV((s) => ({ ...s, autres: s.autres.filter((_, j) => j !== i) }))}
              >
                <Trash2 aria-hidden />
                Retirer cette personne
              </Button>
            ) : null
          }
        >
          <div className="grid gap-5 md:grid-cols-2">
            <Champ
              id={`autre-${a.uid}-prenom`}
              libelle={`Prénom de la personne autorisée ${i + 1}`}
              value={a.prenom}
              onChange={(ev) => majAutre(i, { prenom: ev.target.value })}
            />
            <Champ
              id={`autre-${a.uid}-nom`}
              libelle={`Nom de la personne autorisée ${i + 1}`}
              value={a.nom}
              onChange={(ev) => majAutre(i, { nom: ev.target.value })}
            />
            <Champ
              id={`autre-${a.uid}-lien`}
              libelle={`Lien de la personne autorisée ${i + 1} avec les enfants`}
              value={a.lien}
              onChange={(ev) => majAutre(i, { lien: ev.target.value })}
            />
            <ChampTelephone
              id={`autre-${a.uid}-telephone`}
              libelle={`Téléphone de la personne autorisée ${i + 1} (facultatif)`}
              indicatif={indicatif}
              value={a.telephone}
              onChange={(valeur) => majAutre(i, { telephone: valeur })}
            />
          </div>
          {a.actif ? (
            <ChampPhoto
              libelle={`Photo de la personne autorisée ${i + 1}`}
              obligatoire
              photo={a.photo}
              onChange={(photo) => majAutre(i, { photo })}
            />
          ) : null}
          {a.id ? (
            <label className="flex min-h-touch items-center gap-3 font-bold">
              <input
                type="checkbox"
                className="size-6 accent-bleu"
                checked={!a.actif}
                onChange={(ev) => majAutre(i, { actif: !ev.target.checked })}
              />
              N&apos;est plus autorisée
            </label>
          ) : null}
        </Bloc>
      ))}
      <Button
        type="button"
        variant="ghost"
        className="justify-self-start"
        disabled={v.autres.length >= 8}
        onClick={() => setV((s) => ({ ...s, autres: [...s.autres, nouvelAutre()] }))}
      >
        <Plus aria-hidden />
        Ajouter une personne autorisée
      </Button>

      <Bloc titre="Consentements">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-6 shrink-0 accent-bleu"
            checked={v.consentementDonnees}
            onChange={(e) => setV({ ...v, consentementDonnees: e.target.checked })}
          />
          <span>
            <strong>Obligatoire.</strong> J&apos;accepte que les données de mes enfants soient
            utilisées pour leur sécurité pendant les activités de l&apos;église.
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-6 shrink-0 accent-bleu"
            checked={v.consentementPhotos}
            onChange={(e) => setV({ ...v, consentementPhotos: e.target.checked })}
          />
          <span>J&apos;accepte que mes enfants soient photographiés pour leur fiche.</span>
        </label>
      </Bloc>

      <Button
        type="submit"
        variant="bleu"
        size="xl"
        className="justify-self-start"
        disabled={enCours}
      >
        {libelleBouton}
      </Button>
    </form>
  );
}

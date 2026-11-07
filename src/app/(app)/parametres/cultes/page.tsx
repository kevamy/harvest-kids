import type { Metadata } from "next";
import { NotchCard } from "@/components/hk/notch-card";
import { JOURS } from "@/lib/cultes";
import { peut } from "@/lib/rbac";
import { listerCultes } from "@/server/cultes";
import { lireParametres } from "@/server/parametres";
import { contextePage } from "../../acces";
import { EnteteSection } from "../entete";
import {
  FormulaireCulte,
  FormulaireDelais,
  FormulaireLieuRetrait,
  FormulaireLieux,
} from "./formulaires";

export const metadata: Metadata = { title: "Cultes et accueil — Paramètres — Harvest Kids" };

const heure = (h: string) => h.replace(":", " h ");

/**
 * Services, alert delays and meeting places (cahier §7.10, §17 points 3, 4 and 6): ADMIN and
 * RESPONSABLE. The place where children are collected is a security rule: ADMIN only.
 */
export default async function ParametresCultes() {
  const acces = await contextePage("sessions.gerer");
  if (!acces) return null;
  const [cultes, parametres] = await Promise.all([
    listerCultes(acces.db),
    lireParametres(acces.db),
  ]);
  const admin = peut(acces.contexte.roles, "eglise.parametrer");

  return (
    <div className="grid gap-6">
      <EnteteSection
        titre="Cultes et accueil"
        description="Horaires des cultes, délais d'alerte, lieux de rendez-vous des parents et lieu du retrait des enfants. Les heures sont celles de l'église ; un horaire modifié s'applique aux sessions créées ensuite."
      />

      <section aria-labelledby="cultes" className="grid gap-4">
        <h2 id="cultes" className="m-0 font-display text-h2 font-semibold">
          Cultes
        </h2>
        <ul className="m-0 grid list-none gap-4 p-0">
          {cultes.map((culte) => (
            <li key={culte.id}>
              <NotchCard couleur="blanc" aria-label={`Culte ${culte.nom}`}>
                <h3 className="m-0 mb-5 font-display text-h3 font-semibold">
                  {culte.nom} · {JOURS[culte.jour]} {heure(culte.heureDebut)} –{" "}
                  {heure(culte.heureFin)}
                  {culte.actif ? null : (
                    <span className="ml-3 align-middle text-label font-bold text-texte-doux">
                      inactif
                    </span>
                  )}
                </h3>
                <FormulaireCulte culte={culte} />
              </NotchCard>
            </li>
          ))}
        </ul>
        <NotchCard couleur="blanc" aria-label="Ajouter un culte">
          <h3 className="m-0 mb-5 font-display text-h3 font-semibold">Ajouter un culte</h3>
          <FormulaireCulte />
        </NotchCard>
      </section>

      <NotchCard couleur="blanc" aria-label="Délais d'alerte">
        <h2 className="m-0 mb-5 font-display text-h2 font-semibold">Délais d&apos;alerte</h2>
        <FormulaireDelais
          nonRecupere={parametres["sessions.delaiAlerteNonRecupereMinutes"]}
          nonArriveEnSalle={parametres["presences.delaiNonArriveEnSalleMinutes"]}
        />
      </NotchCard>

      <NotchCard couleur="blanc" aria-label="Lieux de rendez-vous des parents">
        <h2 className="m-0 mb-2 font-display text-h2 font-semibold">
          Lieux de rendez-vous des parents
        </h2>
        <p className="mt-0 mb-5 text-texte-doux">
          Proposés quand un parent est appelé, et affichés sur l&apos;écran d&apos;appel avec le
          matricule de l&apos;enfant.
        </p>
        <FormulaireLieux lieux={parametres["appels.lieux"]} />
      </NotchCard>

      <NotchCard couleur="blanc" aria-label="Lieu du retrait">
        <h2 className="m-0 mb-5 font-display text-h2 font-semibold">Lieu du retrait</h2>
        {admin ? (
          <FormulaireLieuRetrait lieu={parametres["checkout.lieu"]} />
        ) : (
          <p className="m-0" data-testid="lieu-retrait">
            {parametres["checkout.lieu"] === "ACCUEIL"
              ? "Les enfants sont remis aux parents à l'accueil seulement."
              : "Les enfants sont remis aux parents à l'accueil et à la porte des classes."}{" "}
            <span className="text-texte-doux">Seul un administrateur modifie ce réglage.</span>
          </p>
        )}
      </NotchCard>
    </div>
  );
}

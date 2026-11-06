import type { Metadata } from "next";
import { formaterTelephone } from "@/lib/telephone";
import { comptesDeLEglise } from "@/server/plateforme/comptes-eglise";
import { contextePage } from "../../acces";
import { EnteteSection } from "../entete";
import { Comptes } from "./comptes";

export const metadata: Metadata = { title: "Comptes — Paramètres — Harvest Kids" };

/** Accounts and roles of the church (cahier §7.10, ADR 0014). ADMIN only (comptes.gerer). */
export default async function ParametresComptes() {
  const acces = await contextePage("comptes.gerer");
  if (!acces) return null;
  const comptes = await comptesDeLEglise(acces.contexte);
  return (
    <div className="grid gap-6">
      <EnteteSection
        titre="Comptes et rôles"
        description="Les personnes qui utilisent l'application dans votre église. Un nouveau compte reçoit un lien d'activation que vous lui transmettez vous-même."
      />
      <Comptes
        comptes={comptes.map((c) => ({
          membreId: c.membreId,
          nom: c.nom,
          identifiant: c.email ?? (c.telephone ? formaterTelephone(c.telephone) : ""),
          roles: c.roles,
          etat: c.etat,
          soi: c.soi,
        }))}
      />
    </div>
  );
}

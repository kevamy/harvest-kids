"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { schemaDeverrouillage } from "@/lib/schemas/auth";
import { getSessionCourante } from "@/lib/session";
import { deverrouillerSession } from "@/server/plateforme/espace-personnel";

export type ResultatDeverrouillage = { ok: true } | { ok: false; erreur: string; bloque?: boolean };

export async function deverrouiller(saisie: unknown): Promise<ResultatDeverrouillage> {
  const donnees = schemaDeverrouillage.safeParse(saisie);
  if (!donnees.success) return { ok: false, erreur: "Le code PIN compte 6 chiffres." };

  const session = await getSessionCourante();
  if (!session) return { ok: false, erreur: "Votre session a expiré. Reconnectez-vous." };

  const resultat = await deverrouillerSession(session, donnees.data.pin);
  switch (resultat.statut) {
    case "deverrouille":
      return { ok: true };
    case "incorrect": {
      const n = resultat.essaisRestants;
      return {
        ok: false,
        erreur: `Code PIN incorrect. Il vous reste ${n} essai${n > 1 ? "s" : ""}.`,
      };
    }
    case "bloque":
      return {
        ok: false,
        bloque: true,
        erreur: "Code PIN bloqué pour 15 minutes. Reconnectez-vous avec votre mot de passe.",
      };
    case "non_defini":
      return {
        ok: false,
        bloque: true,
        erreur: "Aucun code PIN n'est défini. Reconnectez-vous avec votre mot de passe.",
      };
  }
}

export async function seDeconnecter(): Promise<never> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/connexion");
}

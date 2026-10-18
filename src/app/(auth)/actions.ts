"use server";

import { headers } from "next/headers";
import { analyserIdentifiant } from "@/lib/identifiant";
import { schemaConnexion, schemaDefinitionPin } from "@/lib/schemas/auth";
import { getSessionCourante } from "@/lib/session";
import { AccesRefuse, getEgliseActive } from "@/lib/tenant";
import {
  choisirEgliseDeLaSession,
  connecterAvecIdentifiant,
  definirPinDuMembre,
} from "@/server/plateforme/espace-personnel";

export type Resultat = { ok: true } | { ok: false; erreur: string };

const IDENTIFIANTS_INCORRECTS =
  "Identifiant ou mot de passe incorrect. Vérifiez votre saisie ou demandez à l'administrateur de votre église.";
const SESSION_EXPIREE = "Votre session a expiré. Reconnectez-vous.";

export async function seConnecter(saisie: unknown): Promise<Resultat> {
  const donnees = schemaConnexion.safeParse(saisie);
  if (!donnees.success) return { ok: false, erreur: IDENTIFIANTS_INCORRECTS };
  const identifiant = analyserIdentifiant(donnees.data.identifiant);
  if (!identifiant) {
    return { ok: false, erreur: "Saisissez une adresse e-mail ou un numéro de téléphone valide." };
  }

  const entetes = await headers();
  const ip = entetes.get("x-forwarded-for")?.split(",")[0]?.trim() || "inconnue";
  const resultat = await connecterAvecIdentifiant(identifiant, donnees.data.motDePasse, {
    entetes,
    ip,
  });
  switch (resultat.statut) {
    case "connecte":
      return { ok: true };
    case "refuse":
      return { ok: false, erreur: IDENTIFIANTS_INCORRECTS };
    case "trop_de_tentatives": {
      const minutes = Math.max(1, Math.ceil(resultat.reessayerDansMs / 60_000));
      return { ok: false, erreur: `Trop de tentatives. Réessayez dans ${minutes} minutes.` };
    }
  }
}

export async function choisirEglise(egliseId: string): Promise<Resultat> {
  const session = await getSessionCourante();
  if (!session) return { ok: false, erreur: SESSION_EXPIREE };
  // The id comes from the person's choice; access is granted only to a member.
  return (await choisirEgliseDeLaSession(session, String(egliseId)))
    ? { ok: true }
    : { ok: false, erreur: "Vous n'êtes pas membre de cette église. Choisissez-en une autre." };
}

export async function definirMonPin(saisie: unknown): Promise<Resultat> {
  const donnees = schemaDefinitionPin.safeParse(saisie);
  if (!donnees.success) {
    return { ok: false, erreur: donnees.error.issues[0]?.message ?? "Code PIN invalide." };
  }
  try {
    const contexte = await getEgliseActive();
    await definirPinDuMembre(contexte.membreId, donnees.data.pin);
    return { ok: true };
  } catch (erreur) {
    if (erreur instanceof AccesRefuse) return { ok: false, erreur: SESSION_EXPIREE };
    throw erreur;
  }
}

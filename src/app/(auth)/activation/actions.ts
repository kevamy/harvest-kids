"use server";

import { headers } from "next/headers";
import { ZodError } from "zod";
import { CompteRefuse } from "@/server/plateforme/comptes";
import { activerMonCompte } from "@/server/plateforme/comptes-eglise";

export type ResultatActivation =
  { ok: true; type: "ACTIVATION" | "REINITIALISATION" } | { ok: false; erreur: string };

/**
 * Sets the password chosen through a one-time link (ADR 0014). Public: the link itself is
 * the proof. Nothing about the account is ever returned, and neither the token nor the
 * password reaches a log.
 */
export async function activer(saisie: unknown): Promise<ResultatActivation> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "inconnue";
  try {
    const { type } = await activerMonCompte(saisie, ip);
    return { ok: true, type };
  } catch (erreur) {
    if (erreur instanceof CompteRefuse) return { ok: false, erreur: erreur.message };
    if (erreur instanceof ZodError) {
      return { ok: false, erreur: erreur.issues[0]?.message ?? "Formulaire incomplet." };
    }
    throw erreur;
  }
}

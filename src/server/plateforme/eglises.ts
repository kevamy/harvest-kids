import "server-only";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { withEglise } from "./db";

/**
 * Default classes and services of a new church (cahier §3 bis), editable by the
 * church afterwards. Provisional values until the leaders answer §17.
 */
export const CLASSES_PAR_DEFAUT = [
  { nom: "Pouponnière", ageMinMois: 0, ageMaxMois: 35, ordre: 1 },
  { nom: "3–5 ans", ageMinMois: 36, ageMaxMois: 71, ordre: 2 },
  { nom: "6–8 ans", ageMinMois: 72, ageMaxMois: 107, ordre: 3 },
  { nom: "9–12 ans", ageMinMois: 108, ageMaxMois: 155, ordre: 4 },
] as const;

export const CULTES_PAR_DEFAUT = [
  { nom: "Culte 1", jour: 0, heureDebut: "08:00", heureFin: "10:00" },
  { nom: "Culte 2", jour: 0, heureDebut: "10:30", heureFin: "12:30" },
] as const;

/** Opaque token of the church's call screen (never derived from its id or slug). */
export function genererJetonEcran(): string {
  return randomBytes(24).toString("base64url");
}

export async function creerEgliseAvecDefauts(
  base: PrismaClient,
  donnees: { nom: string; slug: string; fuseau?: string },
): Promise<string> {
  const eglise = await base.eglise.create({
    data: {
      nom: donnees.nom,
      slug: donnees.slug,
      fuseau: donnees.fuseau ?? "Africa/Porto-Novo",
      ecranToken: genererJetonEcran(),
    },
    select: { id: true },
  });
  // Church data is written inside the church, under RLS.
  await withEglise(base, eglise.id, async (tx) => {
    await tx.classe.createMany({
      data: CLASSES_PAR_DEFAUT.map((c) => ({ ...c, egliseId: eglise.id })),
    });
    await tx.culte.createMany({
      data: CULTES_PAR_DEFAUT.map((c) => ({ ...c, egliseId: eglise.id })),
    });
  });
  return eglise.id;
}

export async function infosEglise(base: PrismaClient, egliseId: string) {
  return base.eglise.findUnique({
    where: { id: egliseId },
    select: { id: true, nom: true, logoKey: true, logoClairKey: true, fuseau: true },
  });
}

import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { creerCompte, rattacherMembre } from "./comptes";
import type { TransactionPrisma } from "./db";

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

export const FUSEAUX_PROPOSES = [
  "Africa/Porto-Novo",
  "Africa/Lagos",
  "Africa/Lome",
  "Africa/Abidjan",
  "Africa/Douala",
  "Africa/Kinshasa",
  "Europe/Paris",
] as const;

/** Opaque token of the church's call screen (never derived from its id or slug). */
export function genererJetonEcran(): string {
  return randomBytes(24).toString("base64url");
}

export const schemaNouvelleEglise = z.object({
  nom: z.string().trim().min(3, "Le nom compte au moins 3 caractères.").max(120),
  slug: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "Lettres minuscules, chiffres et tirets seulement (ex. eglise-cotonou).",
    )
    .min(3, "L'adresse courte compte au moins 3 caractères.")
    .max(40),
  fuseau: z.enum(FUSEAUX_PROPOSES),
  admin: z.object({
    nom: z.string().trim().min(2, "Saisissez le nom de l'administrateur."),
    email: z.email("Saisissez une adresse e-mail valide.").transform((e) => e.toLowerCase()),
    motDePasse: z.string().min(10, "Le mot de passe provisoire compte au moins 10 caractères."),
  }),
});
export type NouvelleEglise = z.infer<typeof schemaNouvelleEglise>;

/** Classes and services of a new church, written inside it (under RLS). */
async function creerDefauts(tx: TransactionPrisma, egliseId: string) {
  await tx.$executeRaw`SELECT set_config('app.eglise_id', ${egliseId}, TRUE)`;
  await tx.classe.createMany({
    data: CLASSES_PAR_DEFAUT.map((c) => ({ ...c, egliseId })),
  });
  await tx.culte.createMany({
    data: CULTES_PAR_DEFAUT.map((c) => ({ ...c, egliseId })),
  });
}

export async function creerEgliseAvecDefauts(
  base: PrismaClient,
  donnees: { nom: string; slug: string; fuseau?: string },
): Promise<string> {
  return base.$transaction(async (tx) => {
    const eglise = await tx.eglise.create({
      data: {
        nom: donnees.nom,
        slug: donnees.slug,
        fuseau: donnees.fuseau ?? "Africa/Porto-Novo",
        ecranToken: genererJetonEcran(),
      },
      select: { id: true },
    });
    await creerDefauts(tx, eglise.id);
    return eglise.id;
  });
}

export type ResultatCreation = { statut: "creee"; egliseId: string } | { statut: "slug_pris" };

/**
 * Creates a church, its defaults and its first administrator in one transaction
 * (cahier §3 bis). An existing account (member of another church) is attached
 * instead of being duplicated.
 */
export async function creerEgliseAvecPremierAdmin(
  base: PrismaClient,
  donnees: NouvelleEglise,
  superAdminId: string,
): Promise<ResultatCreation> {
  if (await base.eglise.findUnique({ where: { slug: donnees.slug }, select: { id: true } })) {
    return { statut: "slug_pris" };
  }
  const egliseId = await base.$transaction(async (tx) => {
    const eglise = await tx.eglise.create({
      data: {
        nom: donnees.nom,
        slug: donnees.slug,
        fuseau: donnees.fuseau,
        ecranToken: genererJetonEcran(),
      },
      select: { id: true },
    });
    await creerDefauts(tx, eglise.id);

    const existant = await tx.user.findUnique({
      where: { email: donnees.admin.email },
      select: { id: true },
    });
    const userId =
      existant?.id ??
      (await creerCompte(tx, {
        nom: donnees.admin.nom,
        email: donnees.admin.email,
        motDePasse: donnees.admin.motDePasse,
      }));
    await rattacherMembre(tx, { userId, egliseId: eglise.id, roles: ["ADMIN"] });

    // Platform audit: identifiers only, no personal data.
    await tx.auditPlateforme.create({
      data: {
        userId: superAdminId,
        egliseId: eglise.id,
        action: "eglise.creer",
        detail: { slug: donnees.slug, compteExistant: Boolean(existant) },
      },
    });
    return eglise.id;
  });
  return { statut: "creee", egliseId };
}

export async function changerStatutEglise(
  base: PrismaClient,
  egliseId: string,
  statut: "ACTIVE" | "SUSPENDUE",
  superAdminId: string,
): Promise<boolean> {
  return base.$transaction(async (tx) => {
    const { count } = await tx.eglise.updateMany({ where: { id: egliseId }, data: { statut } });
    if (count === 0) return false;
    await tx.auditPlateforme.create({
      data: {
        userId: superAdminId,
        egliseId,
        action: statut === "SUSPENDUE" ? "eglise.suspendre" : "eglise.reactiver",
      },
    });
    return true;
  });
}

/** Platform list: church data and member counts, never personal data. */
export async function listerEglises(base: PrismaClient) {
  const eglises = await base.eglise.findMany({
    orderBy: { nom: "asc" },
    select: {
      id: true,
      nom: true,
      slug: true,
      statut: true,
      createdAt: true,
      _count: { select: { membres: true } },
    },
  });
  return eglises.map(({ _count, ...e }) => ({ ...e, membres: _count.membres }));
}

export async function infosEglise(base: PrismaClient, egliseId: string) {
  return base.eglise.findUnique({
    where: { id: egliseId },
    select: { id: true, nom: true, logoKey: true, logoClairKey: true, fuseau: true },
  });
}

/**
 * Demonstration data (cahier §16). Fictitious only: never real data here.
 * Idempotent: churches and accounts are created only when missing.
 * Run with `pnpm db:seed` (application role, under Row-Level Security).
 */
import type { PrismaClient, Role } from "../src/generated/prisma/client";
import { creerCompte, rattacherMembre } from "../src/server/plateforme/comptes";
import { creerClientPlateforme, withEglise } from "../src/server/plateforme/db";
import { creerEgliseAvecDefauts } from "../src/server/plateforme/eglises";
import { logoEgliseFictif } from "../src/server/plateforme/images-demo";
import { cleFichier } from "../src/lib/fichiers";
import { stockage, type Stockage } from "../src/lib/storage";
import { type DansEglise, reparerTelephonesDemo, semerFamilles } from "./seed-familles";
import { autorisationSeed } from "./seed-garde";
import {
  semerCultesDemo,
  semerEpisodeInfirmerie,
  semerHistorique,
  semerLieuRetrait,
} from "./seed-sessions";

try {
  process.loadEnvFile();
} catch {
  // variables come from the environment
}

export const MOT_DE_PASSE_DEMO = process.env.SEED_MOT_DE_PASSE || "Demo-HarvestKids-2026";
export const PIN_DEMO = "482913";
const DOMAINE = "demo.harvest-kids.test";

export const EGLISES_DEMO = [
  {
    cle: "cotonou",
    nom: "Église de démonstration Cotonou",
    slug: "demo-cotonou",
    lieuRetrait: "ACCUEIL",
  },
  {
    cle: "porto-novo",
    nom: "Église de démonstration Porto-Novo",
    slug: "demo-porto-novo",
    // Both check-out places are shown without changing a setting (cahier §7.6).
    lieuRetrait: "ACCUEIL_ET_CLASSES",
  },
] as const;

/**
 * One account per role, and four more monitors (lot 2): with the monitor of both churches,
 * three classes open at their two monitors (RG-05), the fourth shows a forced opening.
 */
const ROLES_DEMO: { role: Role; libelle: string }[] = [
  { role: "ADMIN", libelle: "admin" },
  { role: "RESPONSABLE", libelle: "responsable" },
  { role: "ACCUEIL", libelle: "accueil" },
  { role: "MONITEUR", libelle: "moniteur" },
  { role: "INFIRMERIE", libelle: "infirmerie" },
  { role: "MONITEUR", libelle: "moniteur2" },
  { role: "MONITEUR", libelle: "moniteur3" },
  { role: "MONITEUR", libelle: "moniteur4" },
  { role: "MONITEUR", libelle: "moniteur5" },
];

export function emailDemo(libelle: string, cleEglise: string) {
  return `${libelle}.${cleEglise}@${DOMAINE}`;
}

async function egliseDemo(base: PrismaClient, eglise: (typeof EGLISES_DEMO)[number]) {
  const existante = await base.eglise.findUnique({
    where: { slug: eglise.slug },
    select: { id: true },
  });
  return existante?.id ?? creerEgliseAvecDefauts(base, { nom: eglise.nom, slug: eglise.slug });
}

async function compteDemo(
  base: PrismaClient,
  donnees: { nom: string; email: string; telephone?: string; superAdmin?: boolean },
): Promise<{ id: string; cree: boolean }> {
  const existant = await base.user.findUnique({
    where: { email: donnees.email },
    select: { id: true },
  });
  if (existant) return { id: existant.id, cree: false };
  return { id: await creerCompte(base, { ...donnees, motDePasse: MOT_DE_PASSE_DEMO }), cree: true };
}

async function membreDemo(base: PrismaClient, userId: string, egliseId: string, roles: Role[]) {
  const existant = await base.membre.findUnique({
    where: { egliseId_userId: { egliseId, userId } },
    select: { id: true },
  });
  if (!existant) await rattacherMembre(base, { userId, egliseId, roles, pin: PIN_DEMO });
}

export async function seed(base: PrismaClient, stockage: Stockage) {
  let comptesCrees = 0;
  const ids: Record<string, string> = {};

  for (const eglise of EGLISES_DEMO) {
    const egliseId = await egliseDemo(base, eglise);
    ids[eglise.cle] = egliseId;
    const ville = eglise.cle === "cotonou" ? "Cotonou" : "Porto-Novo";
    for (const [i, { role, libelle }] of ROLES_DEMO.entries()) {
      // "moniteur2" is shown as "Moniteur 2 Cotonou".
      const nom = `${libelle[0]!.toUpperCase()}${libelle.slice(1)}`.replace(/(\d)$/, " $1");
      const compte = await compteDemo(base, {
        nom: `${nom} ${ville}`,
        email: emailDemo(libelle, eglise.cle),
        // Fictitious numbers, for phone sign-in.
        telephone: `+22901970${eglise.cle === "cotonou" ? "1" : "2"}00${i}0`,
      });
      comptesCrees += Number(compte.cree);
      await membreDemo(base, compte.id, egliseId, [role]);
    }
  }

  // One person serving in both churches (cahier §16).
  const double = await compteDemo(base, {
    nom: "Moniteur des deux églises",
    email: `moniteur.deux-eglises@${DOMAINE}`,
  });
  comptesCrees += Number(double.cree);
  for (const egliseId of Object.values(ids)) {
    await membreDemo(base, double.id, egliseId, ["MONITEUR"]);
  }

  const superAdmin = process.env.SUPER_ADMIN_EMAIL;
  if (superAdmin) {
    const compte = await compteDemo(base, {
      nom: "Super-administrateur",
      email: superAdmin,
      superAdmin: true,
    });
    comptesCrees += Number(compte.cree);
  }

  // Church A gets a fictitious logo; church B has none (its name is shown instead).
  const cotonou = await base.eglise.findUniqueOrThrow({
    where: { id: ids.cotonou! },
    select: { logoKey: true },
  });
  if (!cotonou.logoKey) {
    const logoKey = cleFichier(ids.cotonou!, "logo", "logo.png");
    const logoClairKey = cleFichier(ids.cotonou!, "logo", "logo-clair.png");
    await stockage.put(logoKey, await logoEgliseFictif(), "image/png");
    await stockage.put(logoClairKey, await logoEgliseFictif(true), "image/png");
    await base.eglise.update({ where: { id: ids.cotonou! }, data: { logoKey, logoClairKey } });
  }

  let familles = 0;
  let telephonesRepares = 0;
  let cultesCrees = 0;
  let historiques = 0;
  let episodesInfirmerie = 0;
  for (const [i, eglise] of EGLISES_DEMO.entries()) {
    const egliseId = ids[eglise.cle]!;
    const dansEglise: DansEglise = (fn, options) => withEglise(base, egliseId, fn, options);
    familles += await semerFamilles(dansEglise, egliseId, 1000 + i * 97, stockage);
    // Demonstration churches only: data seeded before the ten-digit numbers.
    telephonesRepares += await reparerTelephonesDemo(dansEglise);

    // Lot 2: a session on any day, where children are handed back, last Sunday's history.
    cultesCrees += await semerCultesDemo(dansEglise, egliseId);
    await semerLieuRetrait(dansEglise, egliseId, eglise.lieuRetrait);
    const membres = await base.membre.findMany({
      where: { egliseId, actif: true },
      select: { id: true, userId: true, roles: true, user: { select: { email: true } } },
    });
    const parEmail = (libelle: string) =>
      membres.find((m) => m.user.email === emailDemo(libelle, eglise.cle))?.userId;
    const accueil = parEmail("accueil");
    const responsable = parEmail("responsable");
    const moniteurs = membres
      .filter((m) => m.roles.includes("MONITEUR"))
      .sort((x, y) => x.user.email.localeCompare(y.user.email))
      .map((m) => ({ userId: m.userId, membreId: m.id }));
    if (accueil && responsable) {
      historiques += Number(
        await semerHistorique(dansEglise, egliseId, { accueil, responsable, moniteurs }, stockage),
      );
      // Lot 3: an infirmerie episode, a phone call and a parent call in that history, also
      // added where the lot 2 history already exists. Call screens are paired by the ADMIN.
      episodesInfirmerie += Number(
        await semerEpisodeInfirmerie(dansEglise, egliseId, {
          accueil,
          infirmerie: parEmail("infirmerie") ?? responsable,
        }),
      );
    }
  }

  return {
    eglises: Object.keys(ids).length,
    comptesCrees,
    familles,
    telephonesRepares,
    cultesCrees,
    historiques,
    episodesInfirmerie,
  };
}

async function main() {
  const decision = autorisationSeed(process.env);
  if (!decision.autorise) throw new Error(decision.raison);
  const url = process.env.DATABASE_URL!;
  const base = creerClientPlateforme(url);
  try {
    const resultat = await seed(base, stockage());
    // Counts only: no personal data in logs.
    console.log(
      `Données de démonstration prêtes : ${resultat.eglises} églises, ${resultat.comptesCrees} comptes et ${resultat.familles} familles créés, ${resultat.telephonesRepares} numéros de tuteur réparés, ${resultat.cultesCrees} cultes de démonstration, ${resultat.historiques} sessions passées et ${resultat.episodesInfirmerie} épisodes d'infirmerie ajoutés.`,
    );
  } finally {
    await base.$disconnect();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed.ts")) {
  main().catch((erreur: unknown) => {
    console.error(erreur instanceof Error ? erreur.message : "Échec du seed.");
    process.exit(1);
  });
}

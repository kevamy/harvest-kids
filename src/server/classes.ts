import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { journaliser } from "@/lib/audit";
import type { ClientDeBase, ContexteEglise } from "@/lib/tenant";

/**
 * Classes and age ranges of a church (RG-17), managed by an ADMIN or a RESPONSABLE.
 * Ranges are in months, both bounds included. Overlaps and gaps between active
 * classes are reported, never refused. A class is deactivated, not deleted: past
 * presences keep pointing to it, and editing a range never moves them.
 */
export const AGE_MAX_MOIS = 18 * 12;

export const schemaClasse = z
  .object({
    nom: z.string().trim().min(1, "Saisissez le nom de la classe.").max(60),
    ageMinMois: z.number().int().min(0, "L'âge minimum est d'au moins 0 mois.").max(AGE_MAX_MOIS),
    ageMaxMois: z.number().int().min(0).max(AGE_MAX_MOIS, "L'âge maximum est de 216 mois au plus."),
    salle: z
      .string()
      .trim()
      .max(60)
      .transform((s) => s || null)
      .nullable(),
    capacite: z.number().int().min(1, "La capacité est d'au moins 1 enfant.").max(500).nullable(),
    minMoniteurs: z
      .number()
      .int()
      .min(1, "Il faut au moins 1 moniteur.")
      .max(10, "10 moniteurs au plus."),
    ordre: z.number().int().min(0).max(999),
    active: z.boolean(),
  })
  .refine((c) => c.ageMaxMois >= c.ageMinMois, {
    message: "L'âge maximum doit être supérieur ou égal à l'âge minimum.",
    path: ["ageMaxMois"],
  });
export type SaisieClasse = z.infer<typeof schemaClasse>;

export type Tranche = { id: string; nom: string; ageMinMois: number; ageMaxMois: number };

export type AnalyseTranches = {
  chevauchements: { classes: [string, string]; deMois: number; aMois: number }[];
  trous: { deMois: number; aMois: number }[];
};

/**
 * Overlaps (pairs of classes sharing at least one month) and gaps (months covered by
 * no class, between the youngest and the oldest bound) among the given classes.
 * Bounds are inclusive: 0–35 and 36–71 neither overlap nor leave a gap.
 */
export function analyserTranches(classes: readonly Tranche[]): AnalyseTranches {
  const triees = [...classes].sort(
    (a, b) => a.ageMinMois - b.ageMinMois || a.ageMaxMois - b.ageMaxMois,
  );
  const chevauchements: AnalyseTranches["chevauchements"] = [];
  for (let i = 0; i < triees.length; i++) {
    for (let j = i + 1; j < triees.length; j++) {
      const a = triees[i]!;
      const b = triees[j]!;
      if (b.ageMinMois > a.ageMaxMois) break; // sorted: no later class can overlap a
      chevauchements.push({
        classes: [a.nom, b.nom],
        deMois: b.ageMinMois,
        aMois: Math.min(a.ageMaxMois, b.ageMaxMois),
      });
    }
  }

  const trous: AnalyseTranches["trous"] = [];
  let couvertJusqua: number | null = null;
  for (const classe of triees) {
    if (couvertJusqua !== null && classe.ageMinMois > couvertJusqua + 1) {
      trous.push({ deMois: couvertJusqua + 1, aMois: classe.ageMinMois - 1 });
    }
    couvertJusqua = Math.max(couvertJusqua ?? classe.ageMaxMois, classe.ageMaxMois);
  }
  return { chevauchements, trous };
}

/** "3 ans 6 mois", "11 mois", "2 ans": readable age for warnings and lists. */
export function ageLisible(mois: number): string {
  const ans = Math.floor(mois / 12);
  const reste = mois % 12;
  const partieAns = ans === 0 ? "" : ans === 1 ? "1 an" : `${ans} ans`;
  const partieMois = reste === 0 ? "" : `${reste} mois`;
  return [partieAns, partieMois].filter(Boolean).join(" ") || "0 mois";
}

type Tx = Pick<ClientDeBase, "classe" | "auditLog">;
type Auteur = Pick<ContexteEglise, "userId" | "appareil">;

export function listerClasses(db: Pick<ClientDeBase, "classe">) {
  return db.classe.findMany({
    orderBy: [{ ordre: "asc" }, { ageMinMois: "asc" }, { nom: "asc" }],
    select: {
      id: true,
      nom: true,
      ageMinMois: true,
      ageMaxMois: true,
      salle: true,
      capacite: true,
      minMoniteurs: true,
      ordre: true,
      active: true,
    },
  });
}

export async function creerClasse(tx: Tx, auteur: Auteur, saisie: unknown) {
  const donnees = schemaClasse.parse(saisie);
  const classe = await tx.classe.create({
    // egliseId is added by the scoped client.
    data: donnees as Prisma.ClasseUncheckedCreateInput,
    select: { id: true },
  });
  await journaliser(tx, auteur, {
    action: "classe.creee",
    entite: "Classe",
    entiteId: classe.id,
    apres: donnees,
  });
  return classe;
}

/** Returns false when the class does not exist in the active church. */
export async function modifierClasse(
  tx: Tx,
  auteur: Auteur,
  classeId: string,
  saisie: unknown,
): Promise<boolean> {
  const donnees = schemaClasse.parse(saisie);
  const avant = await tx.classe.findUnique({
    where: { id: classeId },
    select: {
      nom: true,
      ageMinMois: true,
      ageMaxMois: true,
      salle: true,
      capacite: true,
      minMoniteurs: true,
      ordre: true,
      active: true,
    },
  });
  if (!avant) return false;
  await tx.classe.update({ where: { id: classeId }, data: donnees });
  await journaliser(tx, auteur, {
    action: "classe.modifiee",
    entite: "Classe",
    entiteId: classeId,
    avant,
    apres: donnees,
  });
  return true;
}

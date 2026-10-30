import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { journaliser } from "@/lib/audit";
import type { ClientDeBase, ContexteEglise } from "@/lib/tenant";
import { IDS_FORMAT } from "@/server/impression/formats";

/**
 * Church settings stored in `Parametre` (church table, under RLS), one row per key,
 * validated by Zod. A missing or invalid row falls back to the default below, so a
 * new church works without any row and a bad value never breaks a screen.
 */
export const SCHEMAS_PARAMETRES = {
  // RG-16: one card per family (default) or one card per child.
  "cartes.mode": z.enum(["FAMILLE", "ENFANT"]),
  // Cahier §7.10: default print format, front only or both sides.
  impression: z.object({
    format: z.enum(IDS_FORMAT),
    rectoVerso: z.boolean(),
  }),
  // Draft families (CSV import) not finalised after this delay are purged by the daily task.
  "familles.delaiPurgeBrouillonsJours": z
    .number()
    .int("Saisissez un nombre entier de jours.")
    .min(7, "Le délai est d'au moins 7 jours.")
    .max(730, "Le délai est d'au plus 730 jours."),
} as const;

export type CleParametre = keyof typeof SCHEMAS_PARAMETRES;
export type Parametres = { [K in CleParametre]: z.infer<(typeof SCHEMAS_PARAMETRES)[K]> };

export const PARAMETRES_PAR_DEFAUT: Parametres = {
  "cartes.mode": "FAMILLE",
  // Provisional until the leaders settle the defaults of a new church (cahier §17, point 9).
  impression: { format: "90x54", rectoVerso: false },
  "familles.delaiPurgeBrouillonsJours": 90,
};

const CLES = Object.keys(SCHEMAS_PARAMETRES) as CleParametre[];

export async function lireParametres(db: Pick<ClientDeBase, "parametre">): Promise<Parametres> {
  const lignes = await db.parametre.findMany({
    where: { cle: { in: CLES } },
    select: { cle: true, valeur: true },
  });
  const parametres: Parametres = structuredClone(PARAMETRES_PAR_DEFAUT);
  for (const { cle, valeur } of lignes) {
    const lu = SCHEMAS_PARAMETRES[cle as CleParametre].safeParse(valeur);
    if (lu.success) (parametres as Record<string, unknown>)[cle] = lu.data;
  }
  return parametres;
}

/**
 * Writes one setting with an audit entry (before and after), in the caller's
 * transaction. The value is validated again here, whatever the caller did. The church
 * is never named: the scoped client adds the active church to every query.
 */
export async function ecrireParametre<K extends CleParametre>(
  tx: Pick<ClientDeBase, "parametre" | "auditLog">,
  auteur: Pick<ContexteEglise, "userId" | "appareil">,
  cle: K,
  valeur: unknown,
): Promise<Parametres[K]> {
  const donnee = SCHEMAS_PARAMETRES[cle].parse(valeur) as Parametres[K];
  const avant = await tx.parametre.findFirst({ where: { cle }, select: { valeur: true } });
  if (avant) {
    await tx.parametre.updateMany({
      where: { cle },
      data: { valeur: donnee as Prisma.InputJsonValue },
    });
  } else {
    await tx.parametre.create({
      data: {
        cle,
        valeur: donnee as Prisma.InputJsonValue,
      } as Prisma.ParametreUncheckedCreateInput,
    });
  }
  await journaliser(tx, auteur, {
    action: "parametre.modifie",
    entite: "Parametre",
    entiteId: cle,
    // No previous row: the default was in force, the audit entry has no "avant".
    avant: (avant?.valeur ?? undefined) as Prisma.InputJsonValue | undefined,
    apres: donnee as Prisma.InputJsonValue,
  });
  return donnee;
}

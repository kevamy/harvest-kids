import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { journaliser } from "@/lib/audit";
import type { ClientDeBase, ContexteEglise } from "@/lib/tenant";
import { REGLES_TELEPHONE } from "@/lib/telephone";
import { IDS_FORMAT } from "@/server/impression/formats";
import { LIMITES_TEXTES_CARTE, TEXTES_CARTE_PAR_DEFAUT } from "@/server/impression/textes";

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
  // Cahier §7.7 and §17, point 4: after a service's end, delay before each child not yet
  // collected triggers a parent call and an alert (lot 4).
  "sessions.delaiAlerteNonRecupereMinutes": z
    .number({ message: "Saisissez un nombre de minutes." })
    .int("Saisissez un nombre entier de minutes.")
    .min(0, "Le délai est d'au moins 0 minute.")
    .max(120, "Le délai est d'au plus 120 minutes."),
  // Cahier §7.4: a child still "Présent" after this delay is reported as not arrived in class.
  "presences.delaiNonArriveEnSalleMinutes": z
    .number({ message: "Saisissez un nombre de minutes." })
    .int("Saisissez un nombre entier de minutes.")
    .min(1, "Le délai est d'au moins 1 minute.")
    .max(60, "Le délai est d'au plus 60 minutes."),
  // Cahier §17, point 3: check-out at the reception desk only, or also from the class.
  "checkout.lieu": z.enum(["ACCUEIL", "ACCUEIL_ET_CLASSES"], {
    message: "Choisissez où se fait le retrait.",
  }),
  // Cahier §7.5 and §17, point 6: meeting places offered when a parent is called (lot 3).
  "appels.lieux": z
    .array(
      z
        .string()
        .trim()
        .min(1, "Un lieu est vide : complétez-le ou retirez-le.")
        .max(40, "Un lieu compte 40 caractères au plus."),
    )
    .min(1, "Saisissez au moins un lieu de rendez-vous.")
    .max(5, "5 lieux de rendez-vous au plus.")
    .refine(
      (lieux) => new Set(lieux.map((l) => l.toLocaleLowerCase("fr"))).size === lieux.length,
      "Deux lieux portent le même nom : renommez ou retirez l'un d'eux.",
    ),
  // Country code applied to a phone number typed without one.
  "telephone.indicatifParDefaut": z.enum(
    REGLES_TELEPHONE.map((r) => r.indicatif) as [string, ...string[]],
    { message: "Choisissez un indicatif de la liste." },
  ),
  // Card texts (cahier §7.1, §7.10). Lengths are capped so that the text fits every format;
  // a unit test renders the longest allowed text in each one.
  "cartes.textes": z.object({
    afficherTelephone: z.boolean(),
    consigneCourte: z
      .string()
      .trim()
      .min(1, "Saisissez la consigne courte du recto.")
      .max(
        LIMITES_TEXTES_CARTE.consigneCourte,
        `La consigne courte compte ${LIMITES_TEXTES_CARTE.consigneCourte} caractères au plus.`,
      ),
    titreVerso: z
      .string()
      .trim()
      .min(1, "Saisissez le titre du verso.")
      .max(
        LIMITES_TEXTES_CARTE.titreVerso,
        `Le titre du verso compte ${LIMITES_TEXTES_CARTE.titreVerso} caractères au plus.`,
      ),
    consignesVerso: z
      .array(
        z
          .string()
          .trim()
          .min(1, "Une consigne du verso est vide : complétez-la ou retirez-la.")
          .max(
            LIMITES_TEXTES_CARTE.consigneVerso,
            `Une consigne du verso compte ${LIMITES_TEXTES_CARTE.consigneVerso} caractères au plus.`,
          ),
      )
      .min(1, "Saisissez au moins une consigne au verso.")
      .max(
        LIMITES_TEXTES_CARTE.nombreConsignesVerso,
        `${LIMITES_TEXTES_CARTE.nombreConsignesVerso} consignes au plus au verso.`,
      ),
  }),
} as const;

export type CleParametre = keyof typeof SCHEMAS_PARAMETRES;
export type Parametres = { [K in CleParametre]: z.infer<(typeof SCHEMAS_PARAMETRES)[K]> };

export const PARAMETRES_PAR_DEFAUT: Parametres = {
  "cartes.mode": "FAMILLE",
  // Provisional until the leaders settle the defaults of a new church (cahier §17, point 9).
  impression: { format: "90x54", rectoVerso: false },
  "familles.delaiPurgeBrouillonsJours": 90,
  // Cahier §17, points 3, 4 and 6, until the leaders settle them: each church can change them.
  "sessions.delaiAlerteNonRecupereMinutes": 10,
  "presences.delaiNonArriveEnSalleMinutes": 10,
  "checkout.lieu": "ACCUEIL",
  "appels.lieux": ["Accueil enfants", "Infirmerie"],
  "telephone.indicatifParDefaut": "229",
  "cartes.textes": TEXTES_CARTE_PAR_DEFAUT,
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

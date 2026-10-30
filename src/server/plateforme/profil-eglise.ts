import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { cleAppartientA, cleFichier } from "@/lib/fichiers";
import type { ContexteEglise } from "@/lib/tenant";
import { stockage, type Stockage } from "@/lib/storage";
import { prismaPlateforme, withEglise } from "./db";
import { FUSEAUX_PROPOSES } from "./eglises";

/**
 * Profile and logos of the active church (cahier §7.10). `Eglise` is a platform table:
 * it is written here, always for the church id taken from the session context, never
 * from the request. Each change is written with the church's audit entry in one
 * transaction (app.eglise_id set, as for any church write).
 */

const TELEPHONE = /^\+?[0-9 ().-]{6,20}$/;

export const schemaProfilEglise = z.object({
  nom: z.string().trim().min(3, "Le nom compte au moins 3 caractères.").max(120),
  adresse: z
    .string()
    .trim()
    .max(200)
    .transform((s) => s || null)
    .nullable(),
  telephoneAccueil: z
    .string()
    .trim()
    .transform((s) => s || null)
    .nullable()
    .refine((s) => s === null || TELEPHONE.test(s), {
      message: "Saisissez un numéro de téléphone valide, par exemple +229 01 23 45 67.",
    }),
  fuseau: z.enum(FUSEAUX_PROPOSES, { message: "Choisissez un fuseau horaire de la liste." }),
});
export type ProfilEglise = z.infer<typeof schemaProfilEglise>;

/** Checked context (lib/tenant.ts): the church comes from the session, never from a call. */
type Auteur = ContexteEglise;

export async function lireProfilEglise(base: PrismaClient, contexte: ContexteEglise) {
  return base.eglise.findUniqueOrThrow({
    where: { id: contexte.egliseId },
    select: {
      nom: true,
      adresse: true,
      telephoneAccueil: true,
      fuseau: true,
      logoKey: true,
      logoClairKey: true,
    },
  });
}

async function journaliser(
  tx: Parameters<Parameters<typeof withEglise>[2]>[0],
  auteur: Auteur,
  action: string,
  avant: Prisma.InputJsonValue,
  apres: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({
    data: {
      egliseId: auteur.egliseId,
      userId: auteur.userId,
      appareil: auteur.appareil,
      action,
      entite: "Eglise",
      entiteId: auteur.egliseId,
      avant,
      apres,
    },
  });
}

export async function modifierProfilEglise(base: PrismaClient, auteur: Auteur, saisie: unknown) {
  const donnees = schemaProfilEglise.parse(saisie);
  await withEglise(base, auteur.egliseId, async (tx) => {
    const avant = await tx.eglise.findUniqueOrThrow({
      where: { id: auteur.egliseId },
      select: { nom: true, adresse: true, telephoneAccueil: true, fuseau: true },
    });
    await tx.eglise.update({ where: { id: auteur.egliseId }, data: donnees });
    await journaliser(tx, auteur, "eglise.profil_modifie", avant, donnees);
  });
}

// ---------------------------------------------------------------------------
// Logos
// ---------------------------------------------------------------------------

export const LOGO_TAILLE_MAX = 2 * 1024 * 1024;
const LOGO_COTE_MAX = 1200;
const TYPES_LOGO = ["image/png", "image/svg+xml"];

export class LogoRefuse extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogoRefuse";
  }
}

/**
 * SVG or PNG accepted; only a PNG made by sharp is stored, never the uploaded SVG
 * (an SVG can carry scripts). Transparency is kept, the size capped at 1200 px.
 */
export async function convertirLogo(fichier: { type: string; octets: Uint8Array }) {
  if (!TYPES_LOGO.includes(fichier.type)) {
    throw new LogoRefuse("Choisissez un logo au format PNG ou SVG.");
  }
  if (fichier.octets.byteLength === 0) throw new LogoRefuse("Le fichier est vide.");
  if (fichier.octets.byteLength > LOGO_TAILLE_MAX) {
    throw new LogoRefuse("Le logo dépasse 2 Mo. Choisissez un fichier plus léger.");
  }
  // Loaded on demand: a missing native library only breaks the logo upload. Outside the
  // try below, so it surfaces as a server error, never as "unreadable file".
  const { default: sharp } = await import("sharp");
  try {
    const image = sharp(Buffer.from(fichier.octets), { density: 300, limitInputPixels: 40e6 });
    const { width, height } = await image.metadata();
    if (!width || !height) throw new LogoRefuse("Ce fichier n'est pas une image lisible.");
    return await image
      .resize(LOGO_COTE_MAX, LOGO_COTE_MAX, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch (erreur) {
    if (erreur instanceof LogoRefuse) throw erreur;
    throw new LogoRefuse("Ce fichier n'est pas une image lisible. Choisissez un PNG ou un SVG.");
  }
}

export type VarianteLogo = "principal" | "clair";
const COLONNE = { principal: "logoKey", clair: "logoClairKey" } as const;

/**
 * Stores a new logo under a fresh key (no stale browser cache), points the church to it,
 * then deletes the previous file once the transaction is committed.
 */
export async function remplacerLogo(
  base: PrismaClient,
  stockage: Stockage,
  auteur: Auteur,
  variante: VarianteLogo,
  png: Buffer | null,
) {
  const nouvelleCle = png
    ? cleFichier(auteur.egliseId, "logo", `${variante}-${randomUUID()}.png`)
    : null;
  if (png && nouvelleCle) await stockage.put(nouvelleCle, png, "image/png");

  let ancienneCle: string | null = null;
  try {
    await withEglise(base, auteur.egliseId, async (tx) => {
      const eglise = await tx.eglise.findUniqueOrThrow({
        where: { id: auteur.egliseId },
        select: { logoKey: true, logoClairKey: true },
      });
      ancienneCle = eglise[COLONNE[variante]];
      await tx.eglise.update({
        where: { id: auteur.egliseId },
        data: { [COLONNE[variante]]: nouvelleCle },
      });
      await journaliser(
        tx,
        auteur,
        png ? "eglise.logo_remplace" : "eglise.logo_supprime",
        { variante, cle: ancienneCle },
        { variante, cle: nouvelleCle },
      );
    });
  } catch (erreur) {
    // Nothing points to the new file: remove it.
    if (nouvelleCle) await stockage.delete(nouvelleCle).catch(() => undefined);
    throw erreur;
  }
  // Defence in depth: only ever delete a key of this church.
  if (ancienneCle && cleAppartientA(ancienneCle, auteur.egliseId)) {
    await stockage.delete(ancienneCle).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Entry points for pages and Server Actions (shared platform client and storage)
// ---------------------------------------------------------------------------

export function profilEglise(contexte: ContexteEglise) {
  return lireProfilEglise(prismaPlateforme(), contexte);
}

export function enregistrerProfilEglise(auteur: Auteur, saisie: unknown) {
  return modifierProfilEglise(prismaPlateforme(), auteur, saisie);
}

/** Converts and stores a new logo, or removes it when `fichier` is null. */
export async function enregistrerLogo(
  auteur: Auteur,
  variante: VarianteLogo,
  fichier: { type: string; octets: Uint8Array } | null,
) {
  const png = fichier ? await convertirLogo(fichier) : null;
  await remplacerLogo(prismaPlateforme(), stockage(), auteur, variante, png);
}

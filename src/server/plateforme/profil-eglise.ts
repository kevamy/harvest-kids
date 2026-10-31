import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { cleFichier } from "@/lib/fichiers";
import { INDICATIF_PAR_DEFAUT, normaliserTelephone } from "@/lib/telephone";
import type { ContexteEglise } from "@/lib/tenant";
import { stockage, type Stockage } from "@/lib/storage";
import { prismaPlateforme, withEglise } from "./db";
import { programmerSuppression } from "@/server/fichiers-differes";
import { FUSEAUX_PROPOSES } from "./eglises";

/**
 * Profile and logos of the active church (cahier §7.10). `Eglise` is a platform table:
 * it is written here, always for the church id taken from the session context, never
 * from the request. Each change is written with the church's audit entry in one
 * transaction (app.eglise_id set, as for any church write).
 */

export const schemaProfilEglise = z.object({
  nom: z.string().trim().min(3, "Le nom compte au moins 3 caractères.").max(120),
  adresse: z
    .string()
    .trim()
    .max(200)
    .transform((s) => s || null)
    .nullable(),
  // Typed as entered; normalised to E.164 with the church's default country code.
  telephoneAccueil: z
    .string()
    .trim()
    .max(30)
    .transform((s) => s || null)
    .nullable(),
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

/** Refusal of a profile change, with the message saying what to do. */
export class ProfilRefuse extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfilRefuse";
  }
}

export async function modifierProfilEglise(base: PrismaClient, auteur: Auteur, saisie: unknown) {
  const donnees = schemaProfilEglise.parse(saisie);
  await withEglise(base, auteur.egliseId, async (tx) => {
    if (donnees.telephoneAccueil) {
      const parametre = await tx.parametre.findUnique({
        where: { egliseId_cle: { egliseId: auteur.egliseId, cle: "telephone.indicatifParDefaut" } },
        select: { valeur: true },
      });
      const indicatif =
        typeof parametre?.valeur === "string" ? parametre.valeur : INDICATIF_PAR_DEFAUT;
      const normalise = normaliserTelephone(donnees.telephoneAccueil, indicatif);
      if (normalise.statut !== "valide") {
        throw new ProfilRefuse("Téléphone de l'accueil : " + normalise.message);
      }
      donnees.telephoneAccueil = normalise.e164;
    }
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
 * Stores a new logo under a fresh key (no stale browser cache) and points the church to
 * it. The previous file is not deleted at once: it is scheduled for deletion by the daily
 * task 24 hours later, so a tablet still showing the old page never shows a broken image.
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

  try {
    await withEglise(base, auteur.egliseId, async (tx) => {
      const eglise = await tx.eglise.findUniqueOrThrow({
        where: { id: auteur.egliseId },
        select: { logoKey: true, logoClairKey: true },
      });
      const ancienneCle = eglise[COLONNE[variante]];
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
      if (ancienneCle) await programmerSuppression(tx, ancienneCle);
    });
  } catch (erreur) {
    // Nothing points to the new file: remove it.
    if (nouvelleCle) await stockage.delete(nouvelleCle).catch(() => undefined);
    throw erreur;
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

/** What a printed card shows of the church: name, logo (PNG, light backgrounds), phone. */
export async function informationsImpression(contexte: ContexteEglise) {
  const profil = await lireProfilEglise(prismaPlateforme(), contexte);
  const fichier = profil.logoKey ? await stockage().get(profil.logoKey) : null;
  return {
    nom: profil.nom,
    logo: fichier ? Buffer.from(fichier.donnees) : null,
    telephoneAccueil: profil.telephoneAccueil,
  };
}

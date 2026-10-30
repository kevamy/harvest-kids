import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { journaliser } from "@/lib/audit";
import { cleFichier } from "@/lib/fichiers";
import type { Stockage } from "@/lib/storage";
import { attribuerMatricule, type ClientDeBase, type ClientEglise } from "@/lib/tenant";
import { chiffresRecherche, normaliserTelephone } from "@/lib/telephone";
import { programmerSuppression } from "@/server/fichiers-differes";
import { lireParametres } from "@/server/parametres";

/**
 * Families (cahier §7.1): registration, edition, finalisation of a draft, search and
 * purge of expired drafts. Everything goes through the scoped client: the church is never
 * named here. Audit entries hold identifiers and counts only, never personal data.
 *
 * Photos: compulsory for every authorised adult (RG-06), optional for a child, and a
 * child's photo is only stored when the guardian gave the photo consent.
 */

export class FamilleRefusee extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FamilleRefusee";
  }
}

export const ALERTES_RAPIDES = [
  { code: "ALLERGIE_ALIMENTAIRE", libelle: "Allergie alimentaire" },
  { code: "ASTHME", libelle: "Asthme" },
  { code: "EPILEPSIE", libelle: "Épilepsie" },
  { code: "TRAITEMENT", libelle: "Traitement en cours" },
  { code: "AUTRE", libelle: "Autre" },
] as const;
const CODES_ALERTES = ALERTES_RAPIDES.map((a) => a.code) as [string, ...string[]];

const texte = (max: number, message: string) => z.string().trim().min(1, message).max(max);
const facultatif = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .nullable()
    .optional()
    .transform((s) => s ?? null);
// Typed as entered; normalised to E.164 by the service (lib/telephone.ts).
const telephone = (message: string) => z.string().trim().min(1, message).max(30);
const telephoneFacultatif = facultatif(30);

/**
 * Phone number in E.164 with the church's default country code. A number that needs
 * confirmation (Benin, former 8-digit plan) is never stored as such: the form asks.
 */
export function telephoneNormalise(valeur: string, indicatif: string, libelle: string): string {
  const resultat = normaliserTelephone(valeur, indicatif);
  if (resultat.statut === "valide") return resultat.e164;
  throw new FamilleRefusee(`${libelle} : ${resultat.message}`);
}
const telephoneOuNull = (valeur: string | null, indicatif: string, libelle: string) =>
  valeur ? telephoneNormalise(valeur, indicatif, libelle) : null;

/** A photo: none, keep the stored one, or a new file sent in the FormData field `champ`. */
const photo = z
  .union([
    z.object({ champ: z.string().regex(/^photo-[a-z0-9-]+$/) }),
    z.object({ conserver: z.literal(true) }),
  ])
  .nullable();
type SaisiePhoto = z.infer<typeof photo>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const schemaFamille = z.object({
  nom: texte(80, "Saisissez le nom de la famille."),
  notes: facultatif(1000),
  consentementDonnees: z.literal(true, {
    message:
      "Le consentement du tuteur à l'utilisation des données est obligatoire pour valider l'inscription.",
  }),
  consentementPhotos: z.boolean(),
  tuteurs: z
    .array(
      z.object({
        id: z.string().optional(),
        prenom: texte(60, "Saisissez le prénom du tuteur."),
        nom: texte(60, "Saisissez le nom du tuteur."),
        lien: texte(40, "Précisez le lien du tuteur avec les enfants."),
        telephone: telephone("Saisissez le téléphone du tuteur."),
        telephone2: telephoneFacultatif,
        whatsapp: telephoneFacultatif,
        principal: z.boolean(),
        autorise: z.boolean(),
        photo,
      }),
    )
    .min(1, "Ajoutez au moins un tuteur.")
    .max(4),
  enfants: z
    .array(
      z.object({
        id: z.string().optional(),
        prenom: texte(60, "Saisissez le prénom de l'enfant."),
        nom: texte(60, "Saisissez le nom de l'enfant."),
        dateNaissance: z.string().regex(DATE, "Saisissez la date de naissance de l'enfant."),
        sexe: z.enum(["F", "M"]).nullable(),
        alertes: z.array(z.enum(CODES_ALERTES)).max(CODES_ALERTES.length),
        alerteDetail: facultatif(500),
        notes: facultatif(500),
        actif: z.boolean(),
        photo,
      }),
    )
    .max(12),
  autres: z
    .array(
      z.object({
        id: z.string().optional(),
        prenom: texte(60, "Saisissez le prénom de la personne autorisée."),
        nom: texte(60, "Saisissez le nom de la personne autorisée."),
        lien: texte(40, "Précisez le lien de la personne autorisée avec les enfants."),
        telephone: telephoneFacultatif,
        actif: z.boolean(),
        photo,
      }),
    )
    .max(8),
});
export type SaisieFamille = z.infer<typeof schemaFamille>;

/** Age bounds of a child: born, and under 18 (cahier §5: children of the ministry). */
function verifierDateNaissance(valeur: string, maintenant: Date) {
  const date = new Date(`${valeur}T00:00:00Z`);
  const limite = new Date(maintenant);
  limite.setUTCFullYear(limite.getUTCFullYear() - 18);
  if (Number.isNaN(date.getTime()) || date > maintenant || date < limite) {
    throw new FamilleRefusee(
      "La date de naissance d'un enfant n'est pas valide : elle doit être passée et l'enfant avoir moins de 18 ans.",
    );
  }
  return date;
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export const PHOTO_TAILLE_MAX = 3 * 1024 * 1024;
const TYPES_PHOTO = ["image/jpeg", "image/png", "image/webp"];

export type FichierRecu = { type: string; octets: Uint8Array };

/** Photo reduced to 600 px at most, WebP, orientation applied (cahier §10). */
export async function convertirPhoto(fichier: FichierRecu): Promise<Buffer> {
  if (!TYPES_PHOTO.includes(fichier.type) || fichier.octets.byteLength === 0) {
    throw new FamilleRefusee("Une photo doit être une image JPEG, PNG ou WebP. Reprenez la photo.");
  }
  if (fichier.octets.byteLength > PHOTO_TAILLE_MAX) {
    throw new FamilleRefusee("Une photo dépasse 3 Mo. Reprenez la photo.");
  }
  // Loaded on demand, outside the try: a missing native library is a server error.
  const { default: sharp } = await import("sharp");
  try {
    return await sharp(Buffer.from(fichier.octets), { limitInputPixels: 40e6 })
      .rotate()
      .resize(600, 600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw new FamilleRefusee("Une photo n'est pas une image lisible. Reprenez la photo.");
  }
}

type Existant = { photoKey: string | null } | undefined;

/**
 * Key of the photo to keep after the save: a new upload, the stored one, or none.
 * New files are stored at once (and listed in `nouvelles` to be removed if the save
 * fails); a replaced or removed photo is listed in `remplacees` for deferred deletion.
 */
async function resoudrePhoto(
  saisie: SaisiePhoto,
  existant: Existant,
  contexte: {
    egliseId: string;
    photos: Map<string, FichierRecu>;
    stockage: Stockage;
    nouvelles: string[];
    remplacees: string[];
  },
): Promise<string | null> {
  const ancienne = existant?.photoKey ?? null;
  let cle: string | null = null;
  if (saisie && "conserver" in saisie) {
    cle = ancienne;
  } else if (saisie && "champ" in saisie) {
    const fichier = contexte.photos.get(saisie.champ);
    if (!fichier) throw new FamilleRefusee("Une photo n'a pas été reçue. Reprenez la photo.");
    const webp = await convertirPhoto(fichier);
    cle = cleFichier(contexte.egliseId, "photos", `${randomUUID()}.webp`);
    await contexte.stockage.put(cle, webp, "image/webp");
    contexte.nouvelles.push(cle);
  }
  if (ancienne && ancienne !== cle) contexte.remplacees.push(ancienne);
  return cle;
}

// ---------------------------------------------------------------------------
// Registration, edition, finalisation
// ---------------------------------------------------------------------------

type Auteur = { userId: string; appareil: string | null };

/**
 * Registers a new family, or saves an existing one (edition, or finalisation of a draft).
 * The family is finalised: every active child without a matricule gets one (RG-01).
 * Photo files are stored before the transaction and removed again if it fails.
 */
export async function enregistrerFamille(
  db: ClientEglise,
  auteur: Auteur,
  saisieBrute: unknown,
  photos: Map<string, FichierRecu>,
  stockage: Stockage,
  familleId?: string,
): Promise<{ familleId: string }> {
  const saisie = schemaFamille.parse(saisieBrute);
  const maintenant = new Date();
  const indicatif = (await lireParametres(db))["telephone.indicatifParDefaut"];
  for (const [i, t] of saisie.tuteurs.entries()) {
    const libelle = `Tuteur ${i + 1}`;
    t.telephone = telephoneNormalise(t.telephone, indicatif, `${libelle}, téléphone`);
    t.telephone2 = telephoneOuNull(t.telephone2, indicatif, `${libelle}, second téléphone`);
    t.whatsapp = telephoneOuNull(t.whatsapp, indicatif, `${libelle}, WhatsApp`);
  }
  for (const [i, a] of saisie.autres.entries()) {
    a.telephone = telephoneOuNull(a.telephone, indicatif, `Personne autorisée ${i + 1}, téléphone`);
  }

  if (saisie.tuteurs.filter((t) => t.principal).length !== 1) {
    throw new FamilleRefusee("Désignez un seul tuteur comme contact principal.");
  }
  if (!saisie.enfants.some((e) => e.actif)) throw new FamilleRefusee("Ajoutez au moins un enfant.");
  const dates = saisie.enfants.map((e) => verifierDateNaissance(e.dateNaissance, maintenant));

  const existante = familleId
    ? await db.famille.findUnique({
        where: { id: familleId },
        select: {
          finaliseeLe: true,
          consentementDonnees: true,
          consentementPhotos: true,
          tuteurs: { select: { id: true, autorise: { select: { id: true, photoKey: true } } } },
          enfants: { select: { id: true, photoKey: true, matricule: true } },
          autorises: { where: { tuteurId: null }, select: { id: true, photoKey: true } },
        },
      })
    : null;
  if (familleId && !existante) throw new FamilleRefusee("Famille introuvable. Rechargez la page.");

  // Ids sent by the browser must belong to this family (and so to this church).
  const verifierId = (id: string | undefined, connus: { id: string }[] | undefined) => {
    if (id && !connus?.some((c) => c.id === id)) {
      throw new FamilleRefusee("Famille introuvable. Rechargez la page.");
    }
  };
  saisie.tuteurs.forEach((t) => verifierId(t.id, existante?.tuteurs));
  saisie.enfants.forEach((e) => verifierId(e.id, existante?.enfants));
  saisie.autres.forEach((a) => verifierId(a.id, existante?.autorises));

  // RG-06: every authorised adult has a photo, and there is at least one.
  const adultes = [
    ...saisie.tuteurs.filter((t) => t.autorise),
    ...saisie.autres.filter((a) => a.actif),
  ];
  if (adultes.length === 0) {
    throw new FamilleRefusee("Ajoutez au moins une personne autorisée à récupérer les enfants.");
  }
  if (adultes.some((a) => a.photo === null)) {
    throw new FamilleRefusee(
      "Chaque personne autorisée à récupérer les enfants doit avoir une photo. Prenez la photo manquante.",
    );
  }

  const contexte = {
    egliseId: db.egliseId,
    photos,
    stockage,
    nouvelles: [] as string[],
    remplacees: [] as string[],
  };
  try {
    const tuteurs: (SaisieFamille["tuteurs"][number] & { photoKey: string | null })[] = [];
    for (const t of saisie.tuteurs) {
      const ancien = existante?.tuteurs.find((x) => x.id === t.id)?.autorise ?? undefined;
      const cle = t.autorise ? await resoudrePhoto(t.photo, ancien, contexte) : null;
      if (!t.autorise && ancien?.photoKey) contexte.remplacees.push(ancien.photoKey);
      tuteurs.push({ ...t, photoKey: cle });
    }
    const autres: (SaisieFamille["autres"][number] & { photoKey: string | null })[] = [];
    for (const a of saisie.autres) {
      const ancien = existante?.autorises.find((x) => x.id === a.id);
      autres.push({
        ...a,
        photoKey: await resoudrePhoto(a.actif ? a.photo : null, ancien, contexte),
      });
    }
    const enfants: (SaisieFamille["enfants"][number] & { photoKey: string | null })[] = [];
    for (const e of saisie.enfants) {
      const ancien = existante?.enfants.find((x) => x.id === e.id);
      // Without the photo consent, no child photo is stored (and a stored one is removed).
      const choix = saisie.consentementPhotos ? e.photo : null;
      enfants.push({ ...e, photoKey: await resoudrePhoto(choix, ancien, contexte) });
    }

    const id = await db.$tx(async (tx) => {
      const donneesFamille = {
        nom: saisie.nom,
        notes: saisie.notes,
        // The consent date is kept while it stays given.
        consentementDonnees: existante?.consentementDonnees ?? maintenant,
        consentementPhotos: saisie.consentementPhotos
          ? (existante?.consentementPhotos ?? maintenant)
          : null,
        finaliseeLe: existante?.finaliseeLe ?? maintenant,
      };
      const famille = existante
        ? await tx.famille.update({
            where: { id: familleId },
            data: donneesFamille,
            select: { id: true },
          })
        : await tx.famille.create({
            data: donneesFamille as Prisma.FamilleUncheckedCreateInput,
            select: { id: true },
          });

      for (const t of tuteurs) {
        const champs = {
          prenom: t.prenom,
          nom: t.nom,
          lien: t.lien,
          telephone: t.telephone,
          telephone2: t.telephone2,
          whatsapp: t.whatsapp,
          principal: t.principal,
        };
        const tuteur = t.id
          ? await tx.tuteur.update({ where: { id: t.id }, data: champs, select: { id: true } })
          : await tx.tuteur.create({
              data: { ...champs, familleId: famille.id } as Prisma.TuteurUncheckedCreateInput,
              select: { id: true },
            });
        // The guardian's authorised-adult record follows the "autorise" box.
        const adulte = { prenom: t.prenom, nom: t.nom, lien: t.lien, telephone: t.telephone };
        const existant = await tx.personneAutorisee.findFirst({
          where: { tuteurId: tuteur.id },
          select: { id: true },
        });
        if (existant) {
          await tx.personneAutorisee.update({
            where: { id: existant.id },
            data: t.autorise
              ? { ...adulte, photoKey: t.photoKey!, actif: true }
              : { ...adulte, actif: false },
          });
        } else if (t.autorise) {
          await tx.personneAutorisee.create({
            data: {
              ...adulte,
              familleId: famille.id,
              tuteurId: tuteur.id,
              photoKey: t.photoKey!,
            } as Prisma.PersonneAutoriseeUncheckedCreateInput,
          });
        }
      }

      for (const a of autres) {
        const champs = { prenom: a.prenom, nom: a.nom, lien: a.lien, telephone: a.telephone };
        if (a.id) {
          await tx.personneAutorisee.update({
            where: { id: a.id },
            data: a.actif
              ? { ...champs, photoKey: a.photoKey!, actif: true }
              : { ...champs, actif: false },
          });
        } else if (a.actif) {
          await tx.personneAutorisee.create({
            data: {
              ...champs,
              familleId: famille.id,
              photoKey: a.photoKey!,
            } as Prisma.PersonneAutoriseeUncheckedCreateInput,
          });
        }
      }

      for (const [i, e] of enfants.entries()) {
        const champs = {
          prenom: e.prenom,
          nom: e.nom,
          dateNaissance: dates[i]!,
          sexe: e.sexe,
          alertes: e.alertes,
          alerteDetail: e.alerteDetail,
          notes: e.notes,
          photoKey: e.photoKey,
          actif: e.actif,
        };
        if (e.id) {
          const ancien = existante?.enfants.find((x) => x.id === e.id);
          await tx.enfant.update({
            where: { id: e.id },
            data: {
              ...champs,
              // A draft's child receives its matricule at finalisation (RG-01).
              ...(ancien?.matricule ? {} : { matricule: await attribuerMatricule(tx) }),
            },
          });
        } else {
          await tx.enfant.create({
            data: {
              ...champs,
              familleId: famille.id,
              matricule: await attribuerMatricule(tx),
            } as Prisma.EnfantUncheckedCreateInput,
          });
        }
      }

      for (const cle of contexte.remplacees) await programmerSuppression(tx, cle, maintenant);

      await journaliser(tx, auteur, {
        action: !existante
          ? "famille.inscrite"
          : existante.finaliseeLe
            ? "famille.modifiee"
            : "famille.finalisee",
        entite: "Famille",
        entiteId: famille.id,
        apres: {
          tuteurs: saisie.tuteurs.length,
          enfants: saisie.enfants.filter((e) => e.actif).length,
          personnesAutorisees: adultes.length,
          consentementPhotos: saisie.consentementPhotos,
        },
      });
      return famille.id;
    });
    return { familleId: id };
  } catch (erreur) {
    // Nothing points to the new files: remove them.
    for (const cle of contexte.nouvelles) await stockage.delete(cle).catch(() => undefined);
    throw erreur;
  }
}

/**
 * Draft family (CSV import, step 7): guardians and children without matricule, photo or
 * card, until it is finalised at the reception desk. Check-in refuses a draft (lot 2).
 */
export async function creerBrouillon(
  tx: Pick<ClientDeBase, "famille" | "tuteur" | "enfant" | "auditLog">,
  auteur: Auteur,
  indicatif: string,
  brouillon: {
    nom: string;
    tuteurs: { prenom: string; nom: string; lien: string; telephone: string; principal: boolean }[];
    enfants: { prenom: string; nom: string; dateNaissance: Date }[];
  },
) {
  const famille = await tx.famille.create({
    data: { nom: brouillon.nom } as Prisma.FamilleUncheckedCreateInput,
    select: { id: true },
  });
  for (const [i, t] of brouillon.tuteurs.entries()) {
    const telephone = telephoneNormalise(t.telephone, indicatif, `Tuteur ${i + 1}, téléphone`);
    await tx.tuteur.create({
      data: { ...t, telephone, familleId: famille.id } as Prisma.TuteurUncheckedCreateInput,
    });
  }
  for (const e of brouillon.enfants) {
    await tx.enfant.create({
      data: { ...e, familleId: famille.id } as Prisma.EnfantUncheckedCreateInput,
    });
  }
  await journaliser(tx, auteur, {
    action: "famille.brouillon_cree",
    entite: "Famille",
    entiteId: famille.id,
    apres: { tuteurs: brouillon.tuteurs.length, enfants: brouillon.enfants.length },
  });
  return famille;
}

// ---------------------------------------------------------------------------
// Reading and search
// ---------------------------------------------------------------------------

export function lireFamille(db: Pick<ClientDeBase, "famille">, familleId: string) {
  return db.famille.findUnique({
    where: { id: familleId },
    select: {
      id: true,
      nom: true,
      notes: true,
      consentementDonnees: true,
      consentementPhotos: true,
      finaliseeLe: true,
      createdAt: true,
      tuteurs: {
        orderBy: [{ principal: "desc" }, { prenom: "asc" }],
        select: {
          id: true,
          prenom: true,
          nom: true,
          lien: true,
          telephone: true,
          telephone2: true,
          whatsapp: true,
          principal: true,
          autorise: { select: { actif: true, photoKey: true } },
        },
      },
      enfants: {
        orderBy: [{ actif: "desc" }, { dateNaissance: "asc" }],
        select: {
          id: true,
          prenom: true,
          nom: true,
          matricule: true,
          dateNaissance: true,
          sexe: true,
          alertes: true,
          alerteDetail: true,
          notes: true,
          photoKey: true,
          actif: true,
        },
      },
      autorises: {
        where: { tuteurId: null },
        orderBy: [{ actif: "desc" }, { prenom: "asc" }],
        select: {
          id: true,
          prenom: true,
          nom: true,
          lien: true,
          telephone: true,
          photoKey: true,
          actif: true,
        },
      },
    },
  });
}
export type FicheFamille = NonNullable<Awaited<ReturnType<typeof lireFamille>>>;

const RESUME = {
  id: true,
  nom: true,
  finaliseeLe: true,
  createdAt: true,
  enfants: {
    where: { actif: true },
    orderBy: { dateNaissance: "asc" },
    select: { prenom: true, matricule: true },
  },
} satisfies Prisma.FamilleSelect;

/**
 * Quick search (cahier §7.1): child's or guardian's name, family name, phone number or
 * matricule. At most 20 results.
 */
export async function rechercherFamilles(
  db: Pick<ClientDeBase, "famille" | "parametre" | "$queryRaw">,
  terme: string,
) {
  const valeur = terme.trim();
  if (valeur.length < 2) return [];
  const matricule = /^hk-?(\d{1,5})$/i.exec(valeur.replace(/\s/g, ""));
  const contient = { contains: valeur, mode: "insensitive" as const };
  const chiffres = matricule
    ? null
    : chiffresRecherche(valeur, (await lireParametres(db))["telephone.indicatifParDefaut"]);
  // Stored numbers are E.164; a partial number matches their end. Raw SQL through the
  // scoped client: Row-Level Security applies, and the (egliseId, telephone) indexes limit
  // the scan to the active church's numbers. The end of the number itself cannot be served
  // by an index under RLS (ADR 0011).
  const parTelephone = chiffres
    ? (
        await db.$queryRaw<{ familleId: string }[]>`
          SELECT "familleId" FROM "Tuteur"
            WHERE "telephone" LIKE '%' || ${chiffres} OR "telephone2" LIKE '%' || ${chiffres}
          UNION
          SELECT "familleId" FROM "PersonneAutorisee"
            WHERE "telephone" LIKE '%' || ${chiffres}`
      ).map((l) => l.familleId)
    : [];

  const conditions: Prisma.FamilleWhereInput[] = matricule
    ? [{ enfants: { some: { matricule: `HK-${matricule[1]!.padStart(4, "0")}` } } }]
    : [
        { nom: contient },
        { enfants: { some: { OR: [{ prenom: contient }, { nom: contient }] } } },
        { tuteurs: { some: { OR: [{ prenom: contient }, { nom: contient }] } } },
        ...(parTelephone.length > 0 ? [{ id: { in: parTelephone } }] : []),
      ];
  return db.famille.findMany({
    where: { OR: conditions },
    orderBy: { nom: "asc" },
    take: 20,
    select: RESUME,
  });
}

export function listerBrouillons(db: Pick<ClientDeBase, "famille">) {
  return db.famille.findMany({
    where: { finaliseeLe: null },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: RESUME,
  });
}

// ---------------------------------------------------------------------------
// Daily task
// ---------------------------------------------------------------------------

/**
 * Deletes the drafts not finalised within the church's delay, with an audit entry
 * (identifiers only). Called by the daily task only, never when a page is rendered.
 */
export async function purgerBrouillonsExpires(
  db: ClientEglise,
  delaiJours: number,
  maintenant = new Date(),
): Promise<number> {
  const limite = new Date(maintenant.getTime() - delaiJours * 24 * 60 * 60 * 1000);
  const expires = await db.famille.findMany({
    where: { finaliseeLe: null, createdAt: { lt: limite } },
    select: {
      id: true,
      enfants: { select: { photoKey: true } },
      autorises: { select: { photoKey: true } },
    },
  });
  for (const famille of expires) {
    await db.$tx(async (tx) => {
      // Children first (Restrict); guardians, adults and cards follow the family (Cascade).
      await tx.enfant.deleteMany({ where: { familleId: famille.id } });
      await tx.famille.delete({ where: { id: famille.id } });
      const photos = [...famille.enfants, ...famille.autorises].flatMap((p) =>
        p.photoKey ? [p.photoKey] : [],
      );
      for (const cle of photos) await programmerSuppression(tx, cle, maintenant);
      await journaliser(
        tx,
        { userId: null, appareil: "tache-quotidienne" },
        {
          action: "famille.brouillon_purge",
          entite: "Famille",
          entiteId: famille.id,
          apres: { delaiJours },
        },
      );
    });
  }
  return expires.length;
}

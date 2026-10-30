/**
 * File keys (RG-15): every file of a church lives under `eglises/{egliseId}/`,
 * and the read route checks the prefix against the active church.
 */
export const CATEGORIES_FICHIER = ["logo", "photos", "cartes"] as const;
export type CategorieFichier = (typeof CATEGORIES_FICHIER)[number];

const SEGMENT = /^[A-Za-z0-9_-]+$/;
const NOM = /^[A-Za-z0-9_-]+\.(png|jpe?g|webp|pdf)$/;

export const TYPES_CONTENU: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
};

export function cleFichier(egliseId: string, categorie: CategorieFichier, nom: string): string {
  if (!SEGMENT.test(egliseId)) throw new Error("Identifiant d'église invalide.");
  if (!NOM.test(nom)) throw new Error("Nom de fichier invalide.");
  return `eglises/${egliseId}/${categorie}/${nom}`;
}

/**
 * Strict structure check: no `..`, no empty segment, no other prefix, a known
 * category and a known extension. Returns the church id of the key, or null.
 */
export function analyserCle(cle: string): { egliseId: string; categorie: CategorieFichier } | null {
  const segments = cle.split("/");
  if (segments.length !== 4) return null;
  const [racine, egliseId, categorie, nom] = segments as [string, string, string, string];
  if (racine !== "eglises" || !SEGMENT.test(egliseId) || !NOM.test(nom)) return null;
  if (!(CATEGORIES_FICHIER as readonly string[]).includes(categorie)) return null;
  return { egliseId, categorie: categorie as CategorieFichier };
}

export function cleAppartientA(cle: string, egliseId: string): boolean {
  return analyserCle(cle)?.egliseId === egliseId;
}

export function typeContenu(cle: string): string {
  const extension = cle.slice(cle.lastIndexOf(".") + 1).toLowerCase();
  return TYPES_CONTENU[extension] ?? "application/octet-stream";
}

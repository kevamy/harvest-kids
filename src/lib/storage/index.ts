import "server-only";
import { env } from "@/lib/env";
import { analyserCle } from "@/lib/fichiers";
import { creerStockageLocal } from "./local";
import { creerStockageVercelBlob } from "./vercel-blob";

/**
 * File storage with two drivers, chosen by STORAGE_DRIVER: `local` (Docker volume
 * on the VPS) and `vercel-blob` (test environment, private blobs). Files are never
 * served from a public URL: they go through /api/fichiers (RG-11).
 */
export type Fichier = { donnees: Uint8Array; typeContenu: string };

export interface Stockage {
  put(cle: string, donnees: Uint8Array, typeContenu: string): Promise<void>;
  get(cle: string): Promise<Fichier | null>;
  delete(cle: string): Promise<void>;
}

/** Every driver refuses a key that is not a well-formed church key. */
export function verifierCle(cle: string): void {
  if (!analyserCle(cle)) throw new Error("Clé de fichier invalide.");
}

let instance: Stockage | undefined;

export function stockage(): Stockage {
  if (!instance) {
    const config = env();
    instance =
      config.STORAGE_DRIVER === "vercel-blob"
        ? creerStockageVercelBlob(config.BLOB_READ_WRITE_TOKEN!)
        : creerStockageLocal(config.UPLOADS_DIR);
  }
  return instance;
}

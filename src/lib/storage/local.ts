import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { typeContenu } from "@/lib/fichiers";
import { verifierCle, type Stockage } from "./index";

/** Files on disk under UPLOADS_DIR (a Docker volume in production). */
export function creerStockageLocal(dossier: string): Stockage {
  const racine = resolve(dossier);

  const chemin = (cle: string) => {
    verifierCle(cle);
    const complet = resolve(racine, cle);
    // Defence in depth: the resolved path must stay inside the root.
    if (!complet.startsWith(racine + sep)) throw new Error("Clé de fichier invalide.");
    return complet;
  };

  return {
    async put(cle, donnees) {
      const fichier = chemin(cle);
      await mkdir(dirname(fichier), { recursive: true });
      await writeFile(fichier, donnees);
    },
    async get(cle) {
      try {
        return { donnees: await readFile(chemin(cle)), typeContenu: typeContenu(cle) };
      } catch (erreur) {
        if ((erreur as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw erreur;
      }
    },
    async delete(cle) {
      await rm(chemin(cle), { force: true });
    },
  };
}

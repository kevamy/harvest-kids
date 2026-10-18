import "server-only";
import { del, get, put } from "@vercel/blob";
import { verifierCle, type Stockage } from "./index";

/** Private Vercel Blob store (test environment): blobs are read with the token only. */
export function creerStockageVercelBlob(token: string): Stockage {
  return {
    async put(cle, donnees, typeContenu) {
      verifierCle(cle);
      await put(cle, Buffer.from(donnees), {
        access: "private",
        contentType: typeContenu,
        addRandomSuffix: false,
        allowOverwrite: true,
        token,
      });
    },
    async get(cle) {
      verifierCle(cle);
      const resultat = await get(cle, { access: "private", token, useCache: false });
      if (!resultat || resultat.statusCode !== 200) return null;
      const donnees = new Uint8Array(await new Response(resultat.stream).arrayBuffer());
      return { donnees, typeContenu: resultat.blob.contentType };
    },
    async delete(cle) {
      verifierCle(cle);
      await del(cle, { token });
    },
  };
}

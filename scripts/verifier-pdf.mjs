// Renders a real PDF with @react-pdf/renderer and the card fonts, from a deployed
// application folder (the Docker image's /app, or .next/standalone), exactly where the
// application finds them: node_modules for the library, src/server/impression/polices
// for the TTF files (traced by next.config.ts). Fails if anything is missing.
//
//   docker run --rm -i --entrypoint node harvest-kids:ci --input-type=module < scripts/verifier-pdf.mjs
//   cd .next/standalone && node --input-type=module < ../../scripts/verifier-pdf.mjs
import { join } from "node:path";
import { createElement as h } from "react";
import { Document, Font, Page, Text, renderToBuffer } from "@react-pdf/renderer";

const polices = join(process.cwd(), "src", "server", "impression", "polices");
Font.register({ family: "Fredoka", src: join(polices, "Fredoka-SemiBold.ttf"), fontWeight: 600 });
Font.register({ family: "Nunito", src: join(polices, "Nunito-Regular.ttf") });

const pdf = await renderToBuffer(
  h(
    Document,
    null,
    h(
      Page,
      { size: [242.65, 153.01] },
      h(Text, { style: { fontFamily: "Fredoka", fontWeight: 600, fontSize: 12 } }, "HK-0001 Sèna"),
      h(Text, { style: { fontFamily: "Nunito", fontSize: 8 } }, "Église de démonstration"),
    ),
  ),
);
const texte = pdf.toString("latin1");
if (!texte.startsWith("%PDF-")) throw new Error("Le rendu n'est pas un PDF.");
for (const police of ["Fredoka", "Nunito"]) {
  if (!texte.includes(police)) throw new Error(`La police ${police} n'est pas incorporée au PDF.`);
}
console.log(`PDF de ${pdf.length} octets, polices Fredoka et Nunito incorporées.`);

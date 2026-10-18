// Generates the PWA icons from design/logo/harvest-kids-icone.svg.
// Usage: node scripts/generer-icones.mjs (outputs are committed).
import { readFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync("design/logo/harvest-kids-icone.svg");
const tokens = readFileSync("design/tokens.css", "utf8");
const nuit = /--color-nuit:\s*(#[0-9a-fA-F]{6})/.exec(tokens)?.[1];
if (!nuit) throw new Error("--color-nuit introuvable dans design/tokens.css");

const rendu = (taille) => sharp(svg, { density: 384 }).resize(taille, taille).png();

// Full-bleed icon: the logo sits on a nuit square, scaled into the safe zone.
async function pleinCadre(taille, echelle) {
  const interieur = Math.round(taille * echelle);
  const logo = await rendu(interieur).toBuffer();
  return sharp({ create: { width: taille, height: taille, channels: 4, background: nuit } })
    .composite([{ input: logo, gravity: "center" }])
    .png();
}

await rendu(192).toFile("public/icons/icon-192.png");
await rendu(512).toFile("public/icons/icon-512.png");
await (await pleinCadre(512, 0.8)).toFile("public/icons/maskable-512.png");
await (await pleinCadre(180, 0.9)).toFile("src/app/apple-icon.png");
await rendu(64).toFile("src/app/icon.png");
console.log("Icônes générées.");

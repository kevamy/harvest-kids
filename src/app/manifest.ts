import type { MetadataRoute } from "next";
import { COULEURS_HORS_CSS } from "@/lib/couleurs";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Harvest Kids",
    short_name: "Harvest Kids",
    description: "Accueil, suivi et retrait sécurisé des enfants de l'église",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: COULEURS_HORS_CSS.creme,
    theme_color: COULEURS_HORS_CSS.nuit,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harvest Kids",
  description: "Accueil, suivi et retrait sécurisé des enfants de l'église",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}

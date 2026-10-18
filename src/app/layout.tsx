import type { Metadata, Viewport } from "next";
import { Fredoka, Nunito } from "next/font/google";
import { SerwistProvider } from "@serwist/turbopack/react";
import { COULEURS_HORS_CSS } from "@/lib/couleurs";
import "./globals.css";

// Self-hosted at build time: no call to Google in production.
const fredoka = Fredoka({ subsets: ["latin"], variable: "--font-fredoka", display: "swap" });
const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito", display: "swap" });

export const metadata: Metadata = {
  title: "Harvest Kids",
  description: "Accueil, suivi et retrait sécurisé des enfants de l'église",
  applicationName: "Harvest Kids",
  appleWebApp: { capable: true, title: "Harvest Kids", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: COULEURS_HORS_CSS.nuit,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${fredoka.variable} ${nunito.variable}`}>
      <body className="min-h-dvh antialiased">
        <SerwistProvider
          swUrl="/serwist/sw.js"
          disable={process.env.NODE_ENV === "development"}
          // Never cache navigations nor reload by surprise in the middle of a form.
          cacheOnNavigation={false}
          reloadOnOnline={false}
        >
          {children}
        </SerwistProvider>
      </body>
    </html>
  );
}

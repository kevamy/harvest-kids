import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { EcranAppel } from "./ecran-appel";

export const metadata: Metadata = {
  title: "Écran d'appel — Harvest Kids",
  robots: { index: false, follow: false },
};

/**
 * Call screen projected in the hall (cahier §7.8, ADR 0018). Public page without a session:
 * the pairing link's fragment is exchanged once for the device's cookie, then the tiles come
 * from /api/ecran/[slug], which reads the church from that cookie, never from the address.
 */
export default async function PageEcran({ params }: PageProps<"/ecran/[slug]">) {
  const { slug } = await params;
  return (
    <Providers>
      <main>
        <EcranAppel slug={slug} />
      </main>
    </Providers>
  );
}

import type { Metadata } from "next";
import Image from "next/image";
import { HeartPulse, Megaphone, ScanQrCode, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CallBoard } from "@/components/hk/call-board";
import { ChildCard } from "@/components/hk/child-card";
import { MatriculeBadge } from "@/components/hk/matricule-badge";
import { NotchCard } from "@/components/hk/notch-card";
import { Pastille, StatusPill } from "@/components/hk/status-pill";
import { STATUTS_AFFICHES, trierInfirmerieEnTete } from "@/lib/statuts";
import { ScannerDemo } from "./scanner-demo";

export const metadata: Metadata = {
  title: "Design system — Harvest Kids",
  robots: { index: false, follow: false },
};

// Fictitious demonstration data only.
const ENFANTS = trierInfirmerieEnTete([
  {
    prenom: "Ayo",
    nom: "Dossou",
    age: "4 ans",
    classe: "3–5 ans",
    matricule: "HK-0427",
    statut: "EN_SALLE" as const,
    alertes: ["Allergie : arachide"],
  },
  {
    prenom: "Sèna",
    nom: "Agbodjan",
    age: "7 ans",
    classe: "6–8 ans",
    matricule: "HK-0112",
    statut: "INFIRMERIE" as const,
    alertes: ["Asthme"],
  },
  {
    prenom: "Koffi",
    nom: "Hounkpatin",
    age: "10 ans",
    classe: "9–12 ans",
    matricule: "HK-0058",
    statut: "PRESENT" as const,
    alertes: [],
  },
]);

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4">
      <h2 className="m-0 font-display text-h2 font-semibold">{titre}</h2>
      {children}
    </section>
  );
}

export default function DesignPage() {
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between gap-4 bg-nuit px-6 py-4 text-blanc">
        <Image
          src="/logo/harvest-kids-negatif.svg"
          alt="Harvest Kids"
          width={180}
          height={60}
          className="h-12 w-auto"
          priority
        />
        <Button variant="bleu">
          <ScanQrCode aria-hidden />
          Scanner une carte
        </Button>
      </header>

      <main className="mx-auto grid max-w-6xl gap-12 px-6 py-10">
        <div>
          <h1 className="m-0 font-display text-h1 font-semibold">Design system</h1>
          <p className="mt-2 text-texte-doux">
            Composants Harvest Kids, avec des données fictives de démonstration.
          </p>
        </div>

        <Section titre="Boutons">
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="bleu">Enregistrer l&apos;arrivée</Button>
            <Button variant="rose">Confirmer le retrait</Button>
            <Button variant="soleil">
              <Megaphone aria-hidden />
              Appeler le parent
            </Button>
            <Button variant="ghost">Annuler</Button>
            <Button variant="sombre">
              <ScanQrCode aria-hidden />
              Ouvrir le scanner
            </Button>
            <Button variant="bleu" disabled>
              Indisponible
            </Button>
          </div>
          <div>
            <Button variant="bleu" size="xl">
              Scanner la carte famille
            </Button>
          </div>
        </Section>

        <Section titre="Statuts">
          <div className="flex flex-wrap gap-3">
            {STATUTS_AFFICHES.map((statut) => (
              <StatusPill key={statut} statut={statut} />
            ))}
          </div>
        </Section>

        <Section titre="Cartes à encoche">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <NotchCard couleur="nuit" coin={<Users aria-hidden className="size-7 text-nuit" />}>
              <p className="m-0 text-label font-bold text-nuit-doux">Enfants présents</p>
              <p className="m-0 font-display text-display font-semibold">48</p>
            </NotchCard>
            <NotchCard couleur="rose">
              <h3 className="m-0 font-display text-h3 font-semibold">3–5 ans</h3>
              <p className="mt-1">Salle Arc-en-ciel · 2 moniteurs</p>
              <Pastille className="mt-3">Classe ouverte</Pastille>
            </NotchCard>
            <NotchCard couleur="bleu">
              <h3 className="m-0 font-display text-h3 font-semibold">6–8 ans</h3>
              <p className="mt-1">Salle Étoile · 2 moniteurs</p>
              <Pastille className="mt-3">Classe ouverte</Pastille>
            </NotchCard>
            <NotchCard couleur="soleil">
              <p className="m-0 text-label font-bold">Appels en cours</p>
              <p className="m-0 font-display text-display font-semibold">2</p>
            </NotchCard>
            <NotchCard
              couleur="blanc"
              coin={<HeartPulse aria-hidden className="size-7 text-alerte" />}
            >
              <h3 className="m-0 font-display text-h3 font-semibold">Infirmerie</h3>
              <p className="mt-1">1 enfant à l&apos;infirmerie.</p>
            </NotchCard>
          </div>
        </Section>

        <Section titre="Matricule">
          <MatriculeBadge matricule="HK-0427" />
        </Section>

        <Section titre="Fiches enfant">
          <div className="grid gap-4">
            {ENFANTS.map((enfant, index) => (
              <ChildCard key={enfant.matricule} index={index} {...enfant} />
            ))}
          </div>
        </Section>

        <Section titre="Scanner">
          <ScannerDemo />
        </Section>

        <Section titre="Écran d'appel">
          <CallBoard
            tuiles={[
              { matricule: "HK-0427", type: "appel", lieu: "Accueil enfants" },
              { matricule: "HK-0112", type: "infirmerie", lieu: "Infirmerie" },
              { matricule: "HK-0058", type: "pret", lieu: "Accueil enfants" },
            ]}
          />
        </Section>
      </main>

      <footer className="px-6 py-8 text-center text-caption text-texte-doux">Harvest Kids</footer>
    </div>
  );
}

import "server-only";
import { genererJetonCarte } from "@/lib/jetons";
import type { ClientEglise } from "@/lib/tenant";
import { declarerCartePerdue, emettreCarte, type Couverture } from "@/server/cartes/cycle";
import { lireParametres } from "@/server/parametres";
import { formatParId, type IdFormat } from "./formats";
import {
  genererPdfCartes,
  type ContenuCarte,
  type EgliseImpression,
  type OptionsImpression,
} from "./pdf-carte";

/**
 * Printing a family's cards (cahier §7.10, ADR 0008, decision 5 of the lot 1 plan):
 * tokens are drawn first, the PDF is rendered in memory, then one transaction issues the
 * cards with those tokens. A rendering failure creates no card; a failed transaction sends
 * no PDF. The clear token only exists in the returned PDF.
 */
export class ImpressionRefusee extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImpressionRefusee";
  }
}

export type ChoixImpression = {
  format?: IdFormat;
  rectoVerso?: boolean;
  sortie?: OptionsImpression["sortie"];
  /** "Carte perdue": the card in circulation is revoked at once, the new one is active. */
  perdue?: boolean;
};

type Auteur = { userId: string; appareil: string | null };

/** CR80 goes to card printers one card per page; the other formats on A4 sheets. */
export const sortieParDefaut = (format: IdFormat): OptionsImpression["sortie"] =>
  format === "CR80" ? "unitaire" : "planche";

export type CarteAImprimer = { couverture: Couverture; contenu: ContenuCarte };

/**
 * RG-16: one card for the family, or one card per child, each with a freshly drawn
 * token. `enfants`: the active children that have a matricule, in birth order.
 */
export function cartesAImprimer(
  famille: {
    id: string;
    nom: string;
    enfants: { id: string; prenom: string; matricule: string | null }[];
  },
  mode: "FAMILLE" | "ENFANT",
): CarteAImprimer[] {
  const enfants = famille.enfants.map((e) => ({ prenom: e.prenom, matricule: e.matricule! }));
  return mode === "FAMILLE"
    ? [
        {
          couverture: { familleId: famille.id },
          contenu: { jeton: genererJetonCarte(), famille: famille.nom, enfants },
        },
      ]
    : famille.enfants.map((e, i) => ({
        couverture: { familleId: famille.id, enfantId: e.id },
        contenu: { jeton: genererJetonCarte(), famille: famille.nom, enfants: [enfants[i]!] },
      }));
}

/** Children printed on cards: active, with a matricule (finalised family), oldest first. */
export const ENFANTS_IMPRIMES = {
  where: { actif: true, matricule: { not: null } },
  orderBy: { dateNaissance: "asc" },
  select: { id: true, prenom: true, matricule: true },
} as const;

export async function imprimerCartesFamille(
  db: ClientEglise,
  auteur: Auteur,
  familleId: string,
  eglise: EgliseImpression,
  choix: ChoixImpression = {},
): Promise<{ pdf: Buffer; nomFichier: string; cartes: { carteId: string; active: boolean }[] }> {
  const parametres = await lireParametres(db);
  const famille = await db.famille.findUnique({
    where: { id: familleId },
    select: {
      nom: true,
      finaliseeLe: true,
      enfants: ENFANTS_IMPRIMES,
    },
  });
  // A family of another church is invisible (scoped client): same answer as a missing one.
  if (!famille) throw new ImpressionRefusee("Famille introuvable. Rechargez la page.");
  if (!famille.finaliseeLe || famille.enfants.length === 0) {
    throw new ImpressionRefusee(
      "Finalisez l'inscription de la famille avant d'imprimer une carte.",
    );
  }

  const aImprimer = cartesAImprimer(
    { id: familleId, nom: famille.nom, enfants: famille.enfants },
    parametres["cartes.mode"],
  );

  const idFormat = choix.format ?? parametres.impression.format;
  const pdf = await genererPdfCartes(
    aImprimer.map((c) => c.contenu),
    // The church's own card texts (Paramètres › Impression).
    { ...eglise, textes: parametres["cartes.textes"] },
    {
      format: formatParId(idFormat),
      rectoVerso: choix.rectoVerso ?? parametres.impression.rectoVerso,
      sortie: choix.sortie ?? sortieParDefaut(idFormat),
    },
  );

  const cartes = await db.$tx(async (tx) => {
    const emises = [];
    for (const { couverture, contenu } of aImprimer) {
      if (choix.perdue) {
        const { carteId } = await declarerCartePerdue(tx, auteur, couverture, {
          jeton: contenu.jeton,
        });
        emises.push({ carteId, active: true });
      } else {
        const { carteId, active } = await emettreCarte(tx, auteur, couverture, {
          jeton: contenu.jeton,
        });
        emises.push({ carteId, active });
      }
    }
    return emises;
  });

  const nom = famille.nom
    .normalize("NFD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return { pdf, nomFichier: `cartes-${nom || "famille"}.pdf`, cartes };
}

/** Test card (Paramètres › Impression): fictitious family, token registered nowhere. */
export function pdfEssai(
  eglise: EgliseImpression,
  format: IdFormat,
  rectoVerso: boolean,
  sortie: OptionsImpression["sortie"] = sortieParDefaut(format),
): Promise<Buffer> {
  return genererPdfCartes(
    [
      {
        jeton: genererJetonCarte(),
        famille: "Exemple",
        enfants: [
          { prenom: "Ayo", matricule: "HK-0001" },
          { prenom: "Sèna", matricule: "HK-0002" },
        ],
      },
    ],
    eglise,
    { format: formatParId(format), rectoVerso, sortie, essai: true },
  );
}

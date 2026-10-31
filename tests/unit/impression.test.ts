import { describe, expect, it } from "vitest";
import { FORMATS, formatParId } from "@/server/impression/formats";
import { pdfEssai } from "@/server/impression/cartes";
import {
  A4,
  FOND_PERDU_MM,
  MARGE_PLANCHE_MM,
  QR_MIN_MM,
  SECURITE_MM,
  calculerGabarit,
  disposerPlanche,
  enPoints,
  positionsVerso,
} from "@/server/impression/planche";
import { matriceQr } from "@/server/impression/qr";
import { genererJetonCarte } from "@/lib/jetons";

const EGLISE = { nom: "Église de démonstration", logo: null, telephoneAccueil: "+2290197451233" };

/** Page sizes of a PDF, in points, read from its /MediaBox entries. */
function taillesPages(pdf: Buffer): [number, number][] {
  const texte = pdf.toString("latin1");
  return [...texte.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
}

describe("planches A4", () => {
  it("place des cartes entières, fond perdu compris, dans les marges de la page", () => {
    for (const format of FORMATS) {
      const planche = disposerPlanche(format);
      expect(planche.parPage, format.id).toBeGreaterThanOrEqual(4);
      for (const { xMm, yMm } of planche.positions) {
        expect(xMm - FOND_PERDU_MM).toBeGreaterThanOrEqual(MARGE_PLANCHE_MM - 1e-9);
        expect(yMm - FOND_PERDU_MM).toBeGreaterThanOrEqual(MARGE_PLANCHE_MM - 1e-9);
        expect(xMm + format.largeurMm + FOND_PERDU_MM).toBeLessThanOrEqual(
          A4.largeurMm - MARGE_PLANCHE_MM + 1e-9,
        );
        expect(yMm + format.hauteurMm + FOND_PERDU_MM).toBeLessThanOrEqual(
          A4.hauteurMm - MARGE_PLANCHE_MM + 1e-9,
        );
      }
    }
    expect(Object.fromEntries(FORMATS.map((f) => [f.id, disposerPlanche(f).parPage]))).toEqual({
      CR80: 8,
      "90x54": 8,
      "90x50": 10,
      "70x100": 4,
      "85x100": 4,
    });
  });

  it("le verso met les colonnes en miroir (impression recto-verso bord long)", () => {
    const planche = disposerPlanche(formatParId("CR80"));
    const verso = positionsVerso(planche);
    expect(verso[0]).toEqual(planche.positions[1]);
    expect(verso[1]).toEqual(planche.positions[0]);
  });
});

describe("gabarits", () => {
  it("un QR code d'au moins 20 mm, zone de silence comprise, dans la zone de sécurité, pour chaque format", () => {
    const matrice = matriceQr(genererJetonCarte());
    for (const format of FORMATS) {
      for (const rectoSeul of [true, false]) {
        const g = calculerGabarit(format, rectoSeul);
        const symboleMm = (g.qr.largeur * matrice.taille) / matrice.total;
        expect(symboleMm, `${format.id} ${rectoSeul}`).toBeGreaterThanOrEqual(QR_MIN_MM);
        expect(g.qr.x).toBeGreaterThanOrEqual(SECURITE_MM);
        expect(g.qr.x + g.qr.largeur).toBeLessThanOrEqual(format.largeurMm - SECURITE_MM);
        expect(g.qr.y + g.qr.hauteur).toBeLessThanOrEqual(format.hauteurMm - SECURITE_MM);
        if (g.pied) expect(g.qr.y + g.qr.hauteur).toBeLessThanOrEqual(g.pied.y);
      }
    }
  });

  it("en grand format portrait, une zone libre en haut pour la perforation", () => {
    for (const format of FORMATS.filter((f) => f.orientation === "portrait")) {
      const g = calculerGabarit(format, false);
      expect(g.perforation?.hauteur).toBeGreaterThanOrEqual(10);
      expect(g.bandeau.y).toBeGreaterThanOrEqual(g.perforation!.hauteur);
      expect(g.corpsMatricule).toBeGreaterThan(
        calculerGabarit(formatParId("CR80"), false).corpsMatricule,
      );
    }
  });

  it("convertit les millimètres en points", () => {
    expect(enPoints(25.4)).toBe(72);
    expect(enPoints(85.6)).toBe(242.65);
    expect(enPoints(53.98)).toBe(153.01);
  });
});

describe("dimensions exactes des PDF (taille de page en points)", () => {
  it("CR80 carte par carte : une page au format exact par face", async () => {
    const pdf = await pdfEssai(EGLISE, "CR80", true, "unitaire");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const pages = taillesPages(pdf);
    expect(pages).toHaveLength(2);
    for (const [l, h] of pages) {
      expect(l).toBeCloseTo(enPoints(85.6), 1);
      expect(h).toBeCloseTo(enPoints(53.98), 1);
    }
  });

  it.each(FORMATS.map((f) => [f.id]))("planche A4 pour le format %s", async (id) => {
    const pdf = await pdfEssai(EGLISE, id as (typeof FORMATS)[number]["id"], false, "planche");
    const pages = taillesPages(pdf);
    expect(pages).toHaveLength(1);
    expect(pages[0]![0]).toBeCloseTo(595.28, 1);
    expect(pages[0]![1]).toBeCloseTo(841.89, 1);
  });
});

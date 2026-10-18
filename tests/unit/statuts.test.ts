import { describe, expect, it } from "vitest";
import { APPARENCE_STATUT, STATUTS_AFFICHES, trierInfirmerieEnTete } from "@/lib/statuts";

describe("apparence des statuts", () => {
  it("donne un libellé et une couleur distincte à chaque statut", () => {
    const libelles = STATUTS_AFFICHES.map((s) => APPARENCE_STATUT[s].libelle);
    const fonds = STATUTS_AFFICHES.map((s) => APPARENCE_STATUT[s].classes.split(" ")[0]);
    expect(new Set(libelles).size).toBe(STATUTS_AFFICHES.length);
    expect(new Set(fonds).size).toBe(STATUTS_AFFICHES.length);
  });

  it("suit la charte StatusPill", () => {
    expect(APPARENCE_STATUT.ATTENDU.classes).toContain("bg-blanc");
    expect(APPARENCE_STATUT.PRESENT.classes).toContain("bg-bleu-voile");
    expect(APPARENCE_STATUT.EN_SALLE.classes).toContain("bg-bleu-layette");
    expect(APPARENCE_STATUT.APPEL.classes).toContain("bg-soleil");
    expect(APPARENCE_STATUT.INFIRMERIE.classes).toContain("bg-alerte text-blanc");
    expect(APPARENCE_STATUT.RECUPERE.classes).toContain("bg-succes text-blanc");
  });

  it("n'utilise jamais le rose plein, réservé au check-out", () => {
    for (const s of STATUTS_AFFICHES) {
      expect(APPARENCE_STATUT[s].classes).not.toMatch(/rose-fonce/);
    }
  });
});

describe("trierInfirmerieEnTete (RG-07)", () => {
  it("place les enfants à l'infirmerie en tête sans changer l'ordre des autres", () => {
    const liste = [
      { id: 1, statut: "EN_SALLE" as const },
      { id: 2, statut: "INFIRMERIE" as const },
      { id: 3, statut: "PRESENT" as const },
      { id: 4, statut: "INFIRMERIE" as const },
    ];
    expect(trierInfirmerieEnTete(liste).map((e) => e.id)).toEqual([2, 4, 1, 3]);
    expect(liste.map((e) => e.id)).toEqual([1, 2, 3, 4]);
  });
});

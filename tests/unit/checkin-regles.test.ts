import { describe, expect, it } from "vitest";
import {
  ALPHABET_CODE_RETRAIT,
  FORMAT_CODE_RETRAIT,
  ageEnMoisRevolus,
  classeProposee,
  genererCodeRetrait,
  type ClasseCandidate,
} from "@/server/checkin-regles";

const jour = (j: string) => new Date(`${j}T00:00:00Z`);

describe("code de retrait (RG-04)", () => {
  it("4 caractères sans 0, O, 1, I ni L", () => {
    expect(ALPHABET_CODE_RETRAIT).not.toMatch(/[0O1IL]/);
    expect(ALPHABET_CODE_RETRAIT).toHaveLength(31);
    for (let i = 0; i < 200; i++) expect(genererCodeRetrait()).toMatch(FORMAT_CODE_RETRAIT);
  });

  it("chaque caractère vient de l'alphabet, aux deux extrémités", () => {
    expect(genererCodeRetrait(() => 0)).toBe("2222");
    expect(genererCodeRetrait((max) => max - 1)).toBe("ZZZZ");
    expect(FORMAT_CODE_RETRAIT.test("K7RM")).toBe(true);
    for (const refuse of ["K0RM", "KORM", "K1RM", "KIRM", "KLRM", "k7rm", "K7R"]) {
      expect(FORMAT_CODE_RETRAIT.test(refuse), refuse).toBe(false);
    }
  });
});

describe("âge en mois révolus à la date de la session (RG-17)", () => {
  it("compte les mois entiers, le jour anniversaire inclus", () => {
    expect(ageEnMoisRevolus(jour("2023-03-15"), jour("2026-03-15"))).toBe(36);
    expect(ageEnMoisRevolus(jour("2023-03-15"), jour("2026-03-14"))).toBe(35);
    expect(ageEnMoisRevolus(jour("2023-03-31"), jour("2026-04-30"))).toBe(36);
    expect(ageEnMoisRevolus(jour("2026-03-01"), jour("2026-03-31"))).toBe(0);
    expect(ageEnMoisRevolus(jour("2020-02-29"), jour("2026-02-28"))).toBe(71);
  });
});

describe("classe proposée (RG-17)", () => {
  const classe = (id: string, min: number, max: number, ordre: number, active = true) =>
    ({ id, nom: id, ageMinMois: min, ageMaxMois: max, ordre, active }) satisfies ClasseCandidate;
  const classes = [
    classe("pouponniere", 0, 35, 1),
    classe("petits", 36, 71, 2),
    classe("eveil", 60, 83, 3),
    classe("grands", 72, 107, 4),
    classe("ancienne", 36, 71, 0, false),
  ];

  it("bornes incluses ; la première dans l'ordre, les autres en choix secondaire", () => {
    expect(classeProposee({ classeForceeId: null, ageMois: 35 }, classes)).toEqual({
      proposee: "pouponniere",
      autres: [],
      raison: "age",
    });
    expect(classeProposee({ classeForceeId: null, ageMois: 36 }, classes).proposee).toBe("petits");
    expect(classeProposee({ classeForceeId: null, ageMois: 65 }, classes)).toEqual({
      proposee: "petits",
      autres: ["eveil"],
      raison: "age",
    });
  });

  it("la classe forcée active l'emporte ; inactive, elle est ignorée", () => {
    expect(classeProposee({ classeForceeId: "grands", ageMois: 40 }, classes)).toEqual({
      proposee: "grands",
      autres: ["petits"],
      raison: "forcee",
    });
    expect(classeProposee({ classeForceeId: "ancienne", ageMois: 40 }, classes)).toEqual({
      proposee: "petits",
      autres: [],
      raison: "age",
    });
  });

  it("aucune tranche ne couvre l'enfant : choix à la main", () => {
    expect(classeProposee({ classeForceeId: null, ageMois: 150 }, classes)).toEqual({
      proposee: null,
      autres: [],
      raison: "aucune",
    });
  });
});

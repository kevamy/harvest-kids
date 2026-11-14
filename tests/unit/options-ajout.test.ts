import { describe, expect, it } from "vitest";
import { optionsAjout } from "@/app/(app)/sessions/options-ajout";

const membres = [
  { membreId: "m_awa", nom: "Awa", moniteur: true },
  { membreId: "m_koffi", nom: "Koffi", moniteur: true },
  { membreId: "m_sena", nom: "Sèna", moniteur: false },
  { membreId: "m_yao", nom: "Yao", moniteur: true },
];
const classes = [
  { classeId: "c_petits", nom: "3–5 ans", moniteurs: [{ membreId: "m_awa" }] },
  {
    classeId: "c_grands",
    nom: "6–8 ans",
    moniteurs: [{ membreId: "m_koffi" }, { membreId: "m_sena" }],
  },
];

describe("liste « Ajouter un moniteur » d'une classe", () => {
  it("ne propose pas les personnes déjà dans la classe et signale celles d'une autre classe", () => {
    expect(optionsAjout(membres, classes, "c_petits")).toEqual([
      { membreId: "m_koffi", libelle: "Koffi, dans 6–8 ans", renfort: false },
      { membreId: "m_sena", libelle: "Sèna (renfort), dans 6–8 ans", renfort: true },
      { membreId: "m_yao", libelle: "Yao", renfort: false },
    ]);
    expect(optionsAjout(membres, classes, "c_grands")).toEqual([
      { membreId: "m_awa", libelle: "Awa, dans 3–5 ans", renfort: false },
      { membreId: "m_yao", libelle: "Yao", renfort: false },
    ]);
  });

  it("dans une classe sans moniteur, propose tout le monde, les non-moniteurs en renfort", () => {
    expect(optionsAjout(membres, [], "c_petits").map((o) => o.libelle)).toEqual([
      "Awa",
      "Koffi",
      "Sèna (renfort)",
      "Yao",
    ]);
  });
});

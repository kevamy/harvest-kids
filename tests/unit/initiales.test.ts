import { describe, expect, it } from "vitest";
import { initiales, teinteInitiales } from "@/lib/initiales";

describe("initiales", () => {
  it("prend la première lettre du prénom et du nom, en majuscule", () => {
    expect(initiales("ayo", "Houngbédji")).toBe("AH");
    expect(initiales(" Élodie", "adjovi")).toBe("ÉA");
  });
});

describe("teinteInitiales", () => {
  it("alterne bleu et rose selon la position", () => {
    expect([0, 1, 2, 3].map(teinteInitiales)).toEqual(["bleu", "rose", "bleu", "rose"]);
  });
});

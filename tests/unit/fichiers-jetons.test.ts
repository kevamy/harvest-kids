import { describe, expect, it } from "vitest";
import { analyserCle, cleAppartientA, cleFichier, typeContenu } from "@/lib/fichiers";
import { estJetonCarte, genererJetonCarte } from "@/lib/jetons";

describe("clés de fichiers (RG-15)", () => {
  it("range chaque fichier sous le préfixe de son église", () => {
    expect(cleFichier("eglise_a", "photos", "abc-123.png")).toBe(
      "eglises/eglise_a/photos/abc-123.png",
    );
  });

  it("refuse un nom ou un identifiant d'église douteux", () => {
    expect(() => cleFichier("../b", "photos", "x.png")).toThrow();
    expect(() => cleFichier("a", "photos", "../x.png")).toThrow();
    expect(() => cleFichier("a", "photos", "x.svg")).toThrow();
  });

  it("n'attribue une clé qu'à l'église de son préfixe", () => {
    const cle = "eglises/eglise_a/logo/logo.png";
    expect(cleAppartientA(cle, "eglise_a")).toBe(true);
    expect(cleAppartientA(cle, "eglise_b")).toBe(false);
  });

  it.each([
    "eglises/eglise_a/../eglise_b/photos/x.png",
    "eglises/eglise_b/photos/../../eglise_a/logo/x.png",
    "eglises//photos/x.png",
    "autre/eglise_a/photos/x.png",
    "eglises/eglise_a/secret/x.png",
    "eglises/eglise_a/photos/x.svg",
    "eglises/eglise_a/photos/sous/x.png",
    "/eglises/eglise_a/photos/x.png",
  ])("rejette la clé %s", (cle) => {
    expect(analyserCle(cle)).toBeNull();
    expect(cleAppartientA(cle, "eglise_a")).toBe(false);
  });

  it("déduit le type de contenu de l'extension", () => {
    expect(typeContenu("eglises/a/photos/x.webp")).toBe("image/webp");
    expect(typeContenu("eglises/a/cartes/x.pdf")).toBe("application/pdf");
  });
});

describe("jeton de carte famille (RG-02)", () => {
  it("a le format HKF1. + 22 caractères base62", () => {
    for (let i = 0; i < 200; i++) expect(estJetonCarte(genererJetonCarte())).toBe(true);
  });

  it("ne se répète pas", () => {
    const jetons = new Set(Array.from({ length: 1000 }, genererJetonCarte));
    expect(jetons.size).toBe(1000);
  });

  it("ne ressemble jamais à un matricule", () => {
    expect(estJetonCarte("HK-0427")).toBe(false);
    expect(genererJetonCarte()).not.toMatch(/HK-\d{4}/);
  });
});

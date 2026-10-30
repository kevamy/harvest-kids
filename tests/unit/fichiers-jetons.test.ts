import { describe, expect, it } from "vitest";
import { analyserCle, cleAppartientA, cleFichier, typeContenu } from "@/lib/fichiers";
import {
  FORMAT_EMPREINTE,
  empreinteJeton,
  estJetonBadge,
  estJetonCarte,
  genererJetonBadge,
  genererJetonCarte,
  typeJeton,
} from "@/lib/jetons";

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

describe("jeton de badge moniteur", () => {
  it("a le format HKB1. + 22 caractères base62 et se distingue d'une carte", () => {
    const badge = genererJetonBadge();
    expect(estJetonBadge(badge)).toBe(true);
    expect(estJetonCarte(badge)).toBe(false);
    expect(typeJeton(badge)).toBe("badge");
    expect(typeJeton(genererJetonCarte())).toBe("carte");
    expect(typeJeton("HK-0427")).toBeNull();
    expect(typeJeton(" HKF1.AAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
  });
});

describe("empreinte d'un jeton (ADR 0008)", () => {
  it("est le SHA-256 hexadécimal en minuscules, stable et sans le jeton", () => {
    const jeton = "HKF1.AAAAAAAAAAAAAAAAAAAAAA";
    const empreinte = empreinteJeton(jeton);
    expect(empreinte).toMatch(FORMAT_EMPREINTE);
    expect(empreinteJeton(jeton)).toBe(empreinte);
    expect(empreinte).not.toContain("AAAA");
    // Same value as PostgreSQL's encode(sha256(convert_to(token, 'UTF8')), 'hex').
    expect(empreinteJeton("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("diffère pour deux jetons différents", () => {
    expect(empreinteJeton(genererJetonCarte())).not.toBe(empreinteJeton(genererJetonCarte()));
  });
});

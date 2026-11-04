import { describe, expect, it } from "vitest";
import {
  chiffresRecherche,
  formaterTelephone,
  normaliserTelephone,
  type ResultatTelephone,
} from "@/lib/telephone";

const valide = (e164: string): ResultatTelephone => ({ statut: "valide", e164 });

describe("normalisation des numéros (E.164)", () => {
  it("accepte espaces, tirets, points et parenthèses", () => {
    for (const saisie of [
      "01 97 45 12 33",
      "01-97-45-12-33",
      "01.97.45.12.33",
      "(01) 97 45 12 33",
      "0197451233",
    ]) {
      expect(normaliserTelephone(saisie), saisie).toEqual(valide("+2290197451233"));
    }
  });

  it("accepte +229 et 00229", () => {
    expect(normaliserTelephone("+229 01 97 45 12 33")).toEqual(valide("+2290197451233"));
    expect(normaliserTelephone("00229 01 97 45 12 33")).toEqual(valide("+2290197451233"));
    expect(normaliserTelephone("+2290197451233")).toEqual(valide("+2290197451233"));
  });

  it("un numéro béninois à 8 chiffres n'est jamais enregistré tel quel : il faut confirmer 01", () => {
    for (const saisie of ["97 45 12 33", "+229 97 45 12 33", "0022997451233"]) {
      expect(normaliserTelephone(saisie), saisie).toEqual({
        statut: "a_confirmer",
        e164: "+2290197451233",
        proposition: "01 97 45 12 33",
        message: "Ce numéro a 8 chiffres. Voulez-vous dire 01 97 45 12 33 ?",
      });
    }
  });

  it("accepte un numéro étranger, connu ou non", () => {
    expect(normaliserTelephone("+33 6 12 34 56 78")).toEqual(valide("+33612345678"));
    expect(normaliserTelephone("0033 6 12 34 56 78")).toEqual(valide("+33612345678"));
    expect(normaliserTelephone("+228 90 12 34 56")).toEqual(valide("+22890123456"));
    expect(normaliserTelephone("+234 803 123 4567")).toEqual(valide("+2348031234567"));
    // Unknown country code: any E.164 length (8 to 15 digits).
    expect(normaliserTelephone("+1 415 555 0123")).toEqual(valide("+14155550123"));
  });

  it("applique l'indicatif par défaut de l'église et son préfixe interurbain", () => {
    expect(normaliserTelephone("06 12 34 56 78", "33")).toEqual(valide("+33612345678"));
    expect(normaliserTelephone("0803 123 4567", "234")).toEqual(valide("+2348031234567"));
    expect(normaliserTelephone("90 12 34 56", "228")).toEqual(valide("+22890123456"));
  });

  it("refuse un numéro incomplet, trop long ou contenant des lettres, avec un message qui dit quoi faire", () => {
    for (const saisie of ["01 97 45", "01 97 45 12 33 44", "01 97 AB 12 33", "+229 1234", "+12"]) {
      const resultat = normaliserTelephone(saisie);
      expect(resultat.statut, saisie).toBe("invalide");
      expect(resultat.statut === "invalide" && resultat.message).toMatch(/Saisissez-le en entier/);
    }
  });
});

describe("affichage et recherche", () => {
  it("formate par paires après l'indicatif", () => {
    expect(formaterTelephone("+2290197451233")).toBe("+229 01 97 45 12 33");
    expect(formaterTelephone("+33612345678")).toBe("+33 6 12 34 56 78");
    expect(formaterTelephone("+14155550123")).toBe("+14155550123");
    expect(formaterTelephone("pas un numéro")).toBe("pas un numéro");
  });

  it("la saisie de recherche est normalisée de la même façon", () => {
    expect(chiffresRecherche("01 97 45 12 33")).toBe("2290197451233");
    expect(chiffresRecherche("+229 01 97 45 12 33")).toBe("2290197451233");
    // Former 8-digit number: the full new number is looked for.
    expect(chiffresRecherche("97 45 12 33")).toBe("2290197451233");
    // Partial number: matched on the end of stored numbers.
    expect(chiffresRecherche("45 12 33")).toBe("451233");
    expect(chiffresRecherche("12 33")).toBeNull();
    expect(chiffresRecherche("Sèna")).toBeNull();
  });
});

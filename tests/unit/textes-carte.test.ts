import { describe, expect, it } from "vitest";
import { verifierTextesCarte } from "@/server/impression/mesure";
import { formaterTelephone } from "@/lib/telephone";
import {
  LIMITES_TEXTES_CARTE,
  TEXTES_CARTE_PAR_DEFAUT,
  ligneTelephone,
  textePied,
} from "@/server/impression/textes";
import { SCHEMAS_PARAMETRES } from "@/server/parametres";

/** Realistic French text of exactly `longueur` characters, with long, wide words. */
function texte(longueur: number) {
  const mots =
    "Merci de présenter obligatoirement cette carte nominative au moment du dépôt comme du retrait de chaque enfant accompagné";
  let resultat = "";
  while (resultat.length < longueur) resultat += (resultat ? " " : "") + mots;
  return resultat.slice(0, longueur).trimEnd().padEnd(longueur, "m");
}

const NOM_LE_PLUS_LONG = texte(120); // church name: 120 characters at most (profile)

describe("textes de carte : le plus long texte autorisé tient dans les cinq formats", () => {
  it("valeurs par défaut", async () => {
    expect(
      await verifierTextesCarte({
        nom: "Église de démonstration Cotonou",
        logo: null,
        telephoneAccueil: "+2290197451233",
        textes: TEXTES_CARTE_PAR_DEFAUT,
      }),
    ).toEqual([]);
  });

  it("chaque champ à sa longueur maximale, téléphone affiché, nom d'église le plus long", async () => {
    const textes = SCHEMAS_PARAMETRES["cartes.textes"].parse({
      afficherTelephone: true,
      consigneCourte: texte(LIMITES_TEXTES_CARTE.consigneCourte),
      titreVerso: texte(LIMITES_TEXTES_CARTE.titreVerso),
      consignesVerso: Array.from({ length: LIMITES_TEXTES_CARTE.nombreConsignesVerso }, () =>
        texte(LIMITES_TEXTES_CARTE.consigneVerso),
      ),
    });
    expect(
      await verifierTextesCarte({
        nom: NOM_LE_PLUS_LONG,
        logo: null,
        telephoneAccueil: "+2290197451233",
        textes,
      }),
    ).toEqual([]);
  });

  it("contre-épreuve : un texte au-delà des limites est détecté", async () => {
    const depassements = await verifierTextesCarte({
      nom: NOM_LE_PLUS_LONG,
      logo: null,
      telephoneAccueil: "+2290197451233",
      textes: {
        afficherTelephone: true,
        consigneCourte: texte(200),
        titreVerso: texte(LIMITES_TEXTES_CARTE.titreVerso),
        consignesVerso: Array.from({ length: 6 }, () => texte(200)),
      },
    });
    expect(depassements).toContainEqual({ format: "CR80", zone: "pied" });
    expect(depassements).toContainEqual({ format: "CR80", zone: "verso" });
  });

  it("pied du recto : téléphone formaté s'il est affiché et enregistré, puis la consigne", () => {
    const t = TEXTES_CARTE_PAR_DEFAUT;
    expect(textePied(t, "+2290197451233")).toBe(
      `Accueil enfants : ${formaterTelephone("+2290197451233")} · ${t.consigneCourte}`,
    );
    expect(textePied({ ...t, afficherTelephone: false }, "+2290197451233")).toBe(t.consigneCourte);
    expect(textePied(t, null)).toBe(t.consigneCourte);
    expect(ligneTelephone({ ...t, afficherTelephone: false }, "+2290197451233")).toBeNull();
  });

  it("refuse un texte trop long ou vide, avec un message qui dit quoi faire", () => {
    const schema = SCHEMAS_PARAMETRES["cartes.textes"];
    const valide = { ...TEXTES_CARTE_PAR_DEFAUT };
    expect(
      schema.safeParse({ ...valide, consigneCourte: texte(61) }).error?.issues[0]?.message,
    ).toBe("La consigne courte compte 60 caractères au plus.");
    expect(schema.safeParse({ ...valide, consignesVerso: [] }).success).toBe(false);
    expect(schema.safeParse({ ...valide, consignesVerso: ["a", "b", "c", "d"] }).success).toBe(
      false,
    );
  });
});

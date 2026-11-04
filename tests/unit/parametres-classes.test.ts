import { describe, expect, it } from "vitest";
import { ageLisible, analyserTranches, schemaClasse, type Tranche } from "@/server/classes";
import { FORMATS, IDS_FORMAT, dimensionsLisibles, formatParId } from "@/server/impression/formats";
import { TEXTES_CARTE_PAR_DEFAUT } from "@/server/impression/textes";
import { PARAMETRES_PAR_DEFAUT, SCHEMAS_PARAMETRES } from "@/server/parametres";
import { schemaProfilEglise } from "@/server/plateforme/profil-eglise";

const tranche = (nom: string, ageMinMois: number, ageMaxMois: number): Tranche => ({
  id: nom,
  nom,
  ageMinMois,
  ageMaxMois,
});

describe("RG-17 : analyse des tranches d'âge", () => {
  it("des tranches contiguës (bornes incluses) ne se chevauchent pas et ne laissent pas de trou", () => {
    expect(
      analyserTranches([
        tranche("Pouponnière", 0, 35),
        tranche("3–5 ans", 36, 71),
        tranche("6–8 ans", 72, 107),
      ]),
    ).toEqual({ chevauchements: [], trous: [] });
  });

  it("signale un chevauchement avec les mois communs, quel que soit l'ordre de saisie", () => {
    expect(analyserTranches([tranche("B", 30, 71), tranche("A", 0, 35)])).toEqual({
      chevauchements: [{ classes: ["A", "B"], deMois: 30, aMois: 35 }],
      trous: [],
    });
  });

  it("une borne partagée est un chevauchement d'un mois", () => {
    expect(analyserTranches([tranche("A", 0, 36), tranche("B", 36, 71)]).chevauchements).toEqual([
      { classes: ["A", "B"], deMois: 36, aMois: 36 },
    ]);
  });

  it("une classe incluse dans une autre chevauche sur toute sa tranche", () => {
    expect(analyserTranches([tranche("Large", 0, 100), tranche("Petite", 20, 30)])).toEqual({
      chevauchements: [{ classes: ["Large", "Petite"], deMois: 20, aMois: 30 }],
      trous: [],
    });
  });

  it("signale les trous entre les tranches", () => {
    expect(
      analyserTranches([tranche("A", 0, 35), tranche("B", 48, 71), tranche("C", 72, 107)]).trous,
    ).toEqual([{ deMois: 36, aMois: 47 }]);
  });

  it("une classe incluse ne masque pas le trou suivant", () => {
    expect(
      analyserTranches([
        tranche("Large", 0, 100),
        tranche("Petite", 10, 20),
        tranche("C", 110, 120),
      ]).trous,
    ).toEqual([{ deMois: 101, aMois: 109 }]);
  });

  it("aucune classe : rien à signaler", () => {
    expect(analyserTranches([])).toEqual({ chevauchements: [], trous: [] });
  });

  it("écrit les âges en clair", () => {
    expect(ageLisible(0)).toBe("0 mois");
    expect(ageLisible(11)).toBe("11 mois");
    expect(ageLisible(12)).toBe("1 an");
    expect(ageLisible(42)).toBe("3 ans 6 mois");
    expect(ageLisible(72)).toBe("6 ans");
  });
});

describe("validation d'une classe", () => {
  const valide = {
    nom: " 3–5 ans ",
    ageMinMois: 36,
    ageMaxMois: 71,
    salle: "",
    capacite: null,
    minMoniteurs: 2,
    ordre: 2,
    active: true,
  };

  it("accepte une classe complète et nettoie les champs facultatifs", () => {
    expect(schemaClasse.parse(valide)).toEqual({ ...valide, nom: "3–5 ans", salle: null });
  });

  it("refuse un âge maximum inférieur à l'âge minimum, avec un message qui dit quoi faire", () => {
    const resultat = schemaClasse.safeParse({ ...valide, ageMaxMois: 20 });
    expect(resultat.success).toBe(false);
    expect(resultat.error?.issues[0]?.message).toBe(
      "L'âge maximum doit être supérieur ou égal à l'âge minimum.",
    );
  });

  it("refuse moins d'un moniteur et un âge négatif", () => {
    expect(schemaClasse.safeParse({ ...valide, minMoniteurs: 0 }).success).toBe(false);
    expect(schemaClasse.safeParse({ ...valide, ageMinMois: -1 }).success).toBe(false);
  });
});

describe("paramètres de l'église", () => {
  it("les valeurs par défaut sont valides", () => {
    for (const [cle, valeur] of Object.entries(PARAMETRES_PAR_DEFAUT)) {
      expect(
        SCHEMAS_PARAMETRES[cle as keyof typeof SCHEMAS_PARAMETRES].safeParse(valeur).success,
        cle,
      ).toBe(true);
    }
    expect(PARAMETRES_PAR_DEFAUT).toEqual({
      "cartes.mode": "FAMILLE",
      impression: { format: "90x54", rectoVerso: false },
      "familles.delaiPurgeBrouillonsJours": 90,
      "telephone.indicatifParDefaut": "229",
      "cartes.textes": TEXTES_CARTE_PAR_DEFAUT,
    });
  });

  it("refuse un mode, un format ou un délai inconnus", () => {
    expect(SCHEMAS_PARAMETRES["cartes.mode"].safeParse("CLASSE").success).toBe(false);
    expect(
      SCHEMAS_PARAMETRES.impression.safeParse({ format: "A4", rectoVerso: true }).success,
    ).toBe(false);
    expect(SCHEMAS_PARAMETRES["familles.delaiPurgeBrouillonsJours"].safeParse(3).success).toBe(
      false,
    );
    expect(SCHEMAS_PARAMETRES["familles.delaiPurgeBrouillonsJours"].safeParse(90.5).success).toBe(
      false,
    );
  });
});

describe("formats d'impression (cahier §7.10)", () => {
  it("cinq formats en trois familles, aux dimensions du cahier des charges", () => {
    expect(IDS_FORMAT).toEqual(["CR80", "90x54", "90x50", "70x100", "85x100"]);
    expect(FORMATS.map((f) => [f.id, f.largeurMm, f.hauteurMm, f.orientation])).toEqual([
      ["CR80", 85.6, 53.98, "paysage"],
      ["90x54", 90, 54, "paysage"],
      ["90x50", 90, 50, "paysage"],
      ["70x100", 70, 100, "portrait"],
      ["85x100", 85, 100, "portrait"],
    ]);
    expect(new Set(FORMATS.map((f) => f.famille))).toEqual(
      new Set(["pvc", "imprimerie", "grand-format"]),
    );
  });

  it("affiche les dimensions avec la virgule décimale", () => {
    expect(dimensionsLisibles(formatParId("CR80"))).toBe("85,6 × 53,98 mm");
    expect(dimensionsLisibles(formatParId("70x100"))).toBe("70 × 100 mm");
  });
});

describe("profil de l'église", () => {
  const valide = {
    nom: "Église de démonstration",
    adresse: "",
    telephoneAccueil: "+229 01 23 45 67",
    fuseau: "Africa/Porto-Novo",
  };

  it("accepte un profil complet et vide les champs facultatifs laissés blancs", () => {
    expect(schemaProfilEglise.parse({ ...valide, telephoneAccueil: " " })).toEqual({
      ...valide,
      adresse: null,
      telephoneAccueil: null,
    });
  });

  it("refuse un fuseau hors liste ; le téléphone est vérifié par le service, avec l'indicatif de l'église", () => {
    expect(schemaProfilEglise.safeParse({ ...valide, fuseau: "Mars/Olympus" }).success).toBe(false);
    expect(
      schemaProfilEglise.safeParse({ ...valide, telephoneAccueil: "x".repeat(31) }).success,
    ).toBe(false);
  });
});

/**
 * Family import, pure part (ADR 0013): columns, unusable lines, dates, grouping into
 * families, numbers to confirm or unreadable, duplicates (file and church), choices.
 */
import { describe, expect, it } from "vitest";
import { BOM } from "@/lib/csv";
import {
  ImportRefuse,
  analyserFichier,
  appliquerChoix,
  idCorrection,
  lireDateNaissance,
  type FamilleExistante,
} from "@/server/import-familles/analyse";
import { modeleImport } from "@/server/import-familles/modele";

const MAINTENANT = new Date("2026-11-05T10:00:00Z");
const ENTETE =
  "Nom de famille;Prénom de l'enfant;Nom de l'enfant;Date de naissance;Sexe;Prénom tuteur 1;Nom tuteur 1;Lien tuteur 1;Téléphone tuteur 1;Prénom tuteur 2;Nom tuteur 2;Lien tuteur 2;Téléphone tuteur 2";

const fichier = (...lignes: string[]) => new TextEncoder().encode([ENTETE, ...lignes].join("\r\n"));
const analyser = (octets: Uint8Array, existantes: FamilleExistante[] = []) =>
  analyserFichier(octets, { indicatif: "229", maintenant: MAINTENANT, existantes });

describe("dates de naissance", () => {
  it.each([
    ["05/03/2019", "2019-03-05"],
    ["5/3/2019", "2019-03-05"],
    ["5.3.2019", "2019-03-05"],
    ["2019-03-05", "2019-03-05"],
    ["05/03/2019 00:00", "2019-03-05"],
  ])("accepte %s", (saisie, attendu) => {
    expect(lireDateNaissance(saisie, MAINTENANT)).toEqual({ ok: true, date: attendu });
  });

  it.each([
    ["", "Date de naissance manquante"],
    ["05/03/19", "année sur deux chiffres : saisissez l'année complète"],
    ["31/02/2020", "impossible : vérifiez le jour et le mois"],
    ["mars 2019", "illisible : utilisez le format JJ/MM/AAAA"],
    ["06/11/2026", "dans le futur"],
    ["04/11/2008", "l'enfant aurait 18 ans ou plus"],
  ])("refuse « %s » avec un message clair", (saisie, message) => {
    const resultat = lireDateNaissance(saisie, MAINTENANT);
    expect(resultat.ok).toBe(false);
    expect(!resultat.ok && resultat.message).toContain(message);
  });

  it("accepte un enfant qui n'a pas encore 18 ans", () => {
    expect(lireDateNaissance("06/11/2008", MAINTENANT).ok).toBe(true);
  });
});

describe("colonnes", () => {
  it("reconnaît les en-têtes sans casse, accents ni ordre, et signale les colonnes inconnues", () => {
    const octets = new TextEncoder().encode(
      "DATE DE NAISSANCE,prenom de l enfant,Nom de famille,Remarques\n05/03/2019,Grâce,Ahouansou,x",
    );
    const analyse = analyser(octets);
    expect(analyse.separateur).toBe(",");
    expect(analyse.colonnesIgnorees).toEqual(["Remarques"]);
    expect(analyse.familles[0]!.enfants).toEqual([
      { prenom: "Grâce", nom: "Ahouansou", dateNaissance: "2019-03-05", sexe: null },
    ]);
  });

  it("refuse un fichier sans les colonnes obligatoires, ou avec une colonne en double", () => {
    expect(() => analyser(new TextEncoder().encode("Nom de famille;Sexe\nA;F"))).toThrow(
      /Colonnes manquantes : « Prénom de l'enfant », « Date de naissance »/,
    );
    expect(() =>
      analyser(new TextEncoder().encode("Prénom de l'enfant;Date de naissance;Sexe\nA;1/1/2020;F")),
    ).toThrow(/« Nom de famille »/);
    expect(() =>
      analyser(
        new TextEncoder().encode(
          "Nom de famille;Prénom de l'enfant;Date de naissance;Sexe;SEXE\nA;B;1/1/2020;F;F",
        ),
      ),
    ).toThrow(/« Sexe » apparaît deux fois/);
  });

  it("refuse un fichier vide, sans ligne d'enfant, trop lourd ou trop long", () => {
    expect(() => analyser(new Uint8Array())).toThrow(ImportRefuse);
    expect(() => analyser(fichier())).toThrow(/aucune ligne d'enfant/);
    expect(() => analyser(new Uint8Array(1024 * 1024 + 1).fill(0x41))).toThrow(/1 Mo/);
    const lignes = Array.from({ length: 2001 }, (_, i) => `F${i};E;F${i};1/1/2020`);
    expect(() => analyser(fichier(...lignes))).toThrow(/2\s000 lignes/);
  });

  it("le modèle téléchargeable est en UTF-8 avec BOM, séparé par des points-virgules, et se relit", () => {
    const modele = modeleImport();
    expect(modele.startsWith(BOM)).toBe(true);
    expect(modele.slice(1)).toBe(`${ENTETE}\r\n`);
    const octets = new TextEncoder().encode(`${modele}Agossou;Ayo;Agossou;1/2/2020\r\n`);
    const analyse = analyser(octets);
    expect(analyse.encodage).toBe("utf-8-bom");
    expect(analyse.colonnesIgnorees).toEqual([]);
    expect(analyse.familles).toHaveLength(1);
  });
});

describe("lignes inutilisables", () => {
  it("rejette seulement les lignes sans nom d'enfant ou sans date valide, avec leur numéro", () => {
    const analyse = analyser(
      fichier(
        "Agossou;;Agossou;1/2/2020;;;;;;;;;",
        ";Ayo;;1/2/2020;;;;;;;;;",
        "Agossou;Ayo;Agossou;;;;;;;;;;",
        "Agossou;Ayo;Agossou;01/02/20;;;;;;;;;",
        "Agossou;Ayo;Agossou;1/2/2020;;;;;;;;;",
      ),
    );
    expect(analyse.lignesLues).toBe(5);
    expect(analyse.rejets.map((r) => r.ligne)).toEqual([2, 3, 4, 5]);
    expect(analyse.rejets[0]!.message).toContain("Nom de l'enfant manquant");
    expect(analyse.rejets[2]!.message).toContain("Date de naissance manquante");
    expect(analyse.rejets[3]!.message).toContain("saisissez l'année complète");
    expect(analyse.familles).toHaveLength(1);
  });

  it("le nom de l'enfant reprend le nom de famille, et inversement, avec un avertissement à vérifier", () => {
    const analyse = analyser(fichier("Agossou;Ayo;;1/2/2020", ";Délé;Houngbo;1/2/2020"));
    expect(analyse.familles.map((f) => [f.nom, f.enfants[0]!.nom])).toEqual([
      ["Agossou", "Agossou"],
      ["Houngbo", "Houngbo"],
    ]);
    expect(analyse.familles.map((f) => f.avertissements.filter((a) => a.important))).toEqual([
      [
        {
          ligne: 2,
          important: true,
          message: "Nom de l'enfant absent : repris du nom de famille (« Agossou »). Vérifiez-le.",
        },
      ],
      [
        {
          ligne: 3,
          important: true,
          message: "Nom de famille absent : repris du nom de l'enfant (« Houngbo »). Vérifiez-le.",
        },
      ],
    ]);
    expect(analyse.remarques).toEqual([]);
  });

  it("une colonne de nom absente est signalée une fois pour le fichier", () => {
    const analyse = analyser(
      new TextEncoder().encode(
        "Nom de famille;Prénom de l'enfant;Date de naissance\nAgossou;Ayo;1/2/2020",
      ),
    );
    expect(analyse.remarques).toEqual([
      "La colonne « Nom de l'enfant » est absente : chaque enfant prend le nom de famille. Vérifiez les noms ci-dessous.",
    ]);
    expect(analyse.familles[0]!.avertissements.filter((a) => a.important)).toEqual([]);
  });

  it("un sexe non reconnu est signalé et laissé vide", () => {
    const [famille] = analyser(
      fichier("Agossou;Ayo;Agossou;1/2/2020;Garçon", "Agossou;Abla;Agossou;1/2/2021;X"),
    ).familles;
    expect(famille!.enfants.map((e) => e.sexe)).toEqual(["M", null]);
    expect(famille!.avertissements.map((a) => a.message)).toContain(
      "Sexe « X » non reconnu (F ou M) : à préciser à la finalisation.",
    );
  });
});

describe("regroupement en familles", () => {
  it("une fratrie avec le même téléphone de tuteur 1 forme une famille", () => {
    const analyse = analyser(
      fichier(
        "Ahouansou;Grâce;Ahouansou;14/03/2019;F;Rachel;Ahouansou;Mère;01 97 45 12 33",
        "AHOUANSOU;Daniel;Ahouansou;2/9/2021;M;Rachel;Ahouansou;Mère;+229 0197451233",
      ),
    );
    expect(analyse.familles).toHaveLength(1);
    const [f] = analyse.familles;
    expect(f!.lignes).toEqual([2, 3]);
    expect(f!.enfants.map((e) => e.prenom)).toEqual(["Grâce", "Daniel"]);
    expect(f!.tuteurs).toEqual([
      {
        prenom: "Rachel",
        nom: "Ahouansou",
        lien: "Mère",
        telephone: { statut: "valide", e164: "+2290197451233" },
      },
    ]);
    expect(f!.avertissements).toEqual([]);
    expect(f!.doublons).toEqual([]);
  });

  it("une fratrie sans téléphone se regroupe sur le prénom et le nom du tuteur 1, normalisés", () => {
    const analyse = analyser(
      fichier(
        "Ahouansou;Grâce;Ahouansou;14/03/2019;F;Rachel;Ahouansou;Mère;",
        "AHOUANSOU ;Daniel;Ahouansou;2/9/2021;M; rachel;AHOUANSOU;Mère;",
        "Ahouansou;Élie;Ahouansou;2/9/2022;M;Rachél;Ahouansou;Mère;",
      ),
    );
    expect(analyse.familles).toHaveLength(1);
    expect(analyse.familles[0]!.enfants).toHaveLength(3);
    // The guardian kept is the one of the first line; the warning is given once.
    expect(analyse.familles[0]!.avertissements).toEqual([
      { ligne: 2, message: "Tuteur 1 : aucun numéro, à compléter à la finalisation." },
    ]);
  });

  it("deux familles homonymes avec des tuteurs différents restent distinctes, sans doublon signalé", () => {
    const analyse = analyser(
      fichier(
        "Agossou;Ayo;Agossou;1/2/2020;;Rita;Agossou;Mère;01 97 45 12 33",
        "Agossou;Koffi;Agossou;3/4/2018;;Paul;Agossou;Père;01 66 77 88 99",
        "Agossou;Abla;Agossou;1/2/2017;;Marc;Agossou;Père;",
        "Agossou;Yao;Agossou;1/2/2016;;Luc;Agossou;Oncle;",
      ),
    );
    expect(analyse.familles.map((f) => f.enfants.map((e) => e.prenom))).toEqual([
      ["Ayo"],
      ["Koffi"],
      ["Abla"],
      ["Yao"],
    ]);
    expect(analyse.familles.flatMap((f) => f.doublons)).toEqual([]);
  });

  it("un enfant présent deux fois n'est importé qu'une fois, avec un avertissement", () => {
    const [f] = analyser(
      fichier(
        "Agossou;Ayo;Agossou;1/2/2020;;Rita;Agossou;Mère;01 97 45 12 33",
        "Agossou;AYO;Agossou;01/02/2020;;Rita;Agossou;Mère;01 97 45 12 33",
      ),
    ).familles;
    expect(f!.enfants).toHaveLength(1);
    expect(f!.avertissements[0]).toEqual({
      ligne: 3,
      message: "AYO figure déjà dans cette famille (ligne 2) : importé une seule fois.",
    });
  });

  it("même prénom mais autre date de naissance : deux enfants distincts", () => {
    const [f] = analyser(
      fichier(
        "Agossou;Ayo;Agossou;1/2/2020;;Rita;Agossou;Mère;01 97 45 12 33",
        "Agossou;Ayo;Agossou;1/2/2017;;Rita;Agossou;Mère;01 97 45 12 33",
        "Agossou;Abla;Agossou;1/2/2020;;Rita;Agossou;Mère;01 97 45 12 33",
      ),
    ).familles;
    expect(f!.enfants.map((e) => [e.prenom, e.dateNaissance])).toEqual([
      ["Ayo", "2020-02-01"],
      ["Ayo", "2017-02-01"],
      ["Abla", "2020-02-01"],
    ]);
    expect(f!.avertissements).toEqual([]);
  });

  it("un tuteur différent d'une ligne à l'autre : le premier est retenu, avec un avertissement", () => {
    const [f] = analyser(
      fichier(
        "Agossou;Ayo;Agossou;1/2/2020;;Rita;Agossou;Mère;01 97 45 12 33;Paul;Agossou;Père;01 66 77 88 99",
        "Agossou;Abla;Agossou;1/2/2021;;Rita;Agossou;Mère;01 97 45 12 33;Pierre;Agossou;Père;01 66 77 88 99",
      ),
    ).familles;
    expect(f!.tuteurs.map((t) => t.prenom)).toEqual(["Rita", "Paul"]);
    expect(f!.avertissements).toEqual([
      {
        ligne: 3,
        message: "Tuteur 2 différent de celui de la ligne 2 : celui de la ligne 2 est retenu.",
      },
    ]);
  });
});

describe("numéros", () => {
  const ligne = (telephone: string) =>
    `Agossou;Ayo;Agossou;1/2/2020;;Rita;Agossou;Mère;${telephone}`;

  it("un numéro béninois à 8 chiffres est à confirmer, avec la correction proposée", () => {
    const analyse = analyser(
      fichier(
        ligne("97 45 12 33"),
        "Agossou;Abla;Agossou;1/2/2021;;Rita;Agossou;Mère;01 97 45 12 33",
      ),
    );
    // The proposed correction groups the two lines.
    expect(analyse.familles).toHaveLength(1);
    expect(analyse.familles[0]!.tuteurs[0]!.telephone).toEqual({
      statut: "a_confirmer",
      saisi: "97 45 12 33",
      e164: "+2290197451233",
      proposition: "01 97 45 12 33",
    });
    expect(analyse.rejets).toEqual([]);
  });

  it("sans validation, le tuteur est importé sans ce numéro ; validée, la correction est enregistrée", () => {
    const analyse = analyser(fichier(ligne("97451233")));
    const id = idCorrection("F1", 0);
    const sans = appliquerChoix(analyse, { corrections: [], doublons: [] }).aCreer[0]!;
    expect(sans.tuteurs[0]!.telephone).toBeNull();
    expect(sans.nonValides).toEqual([id]);
    const avec = appliquerChoix(analyse, { corrections: [id], doublons: [] }).aCreer[0]!;
    expect(avec.tuteurs[0]!.telephone).toBe("+2290197451233");
    expect(avec.nonValides).toEqual([]);
  });

  it("un numéro illisible n'est pas rejeté : la famille est importée sans lui, avec un avertissement", () => {
    const analyse = analyser(fichier(ligne("pas de numéro")));
    expect(analyse.rejets).toEqual([]);
    const famille = analyse.familles[0]!;
    expect(famille.avertissements).toEqual([
      {
        ligne: 2,
        message: "Tuteur 1 : numéro illisible (« pas de numéro »), à corriger à la finalisation.",
      },
    ]);
    expect(
      appliquerChoix(analyse, { corrections: [], doublons: [] }).aCreer[0]!.tuteurs[0]!.telephone,
    ).toBeNull();
  });

  it("seul le contact principal sans numéro est signalé : un second tuteur peut ne pas en avoir", () => {
    const [f] = analyser(
      fichier(
        "Agossou;Ayo;Agossou;1/2/2020;;Rita;Agossou;Mère;01 97 45 12 33;Paul;Agossou;Père;",
        "Houngbo;Abla;Houngbo;1/2/2020;;;;;;Marc;Houngbo;Père;",
      ),
    ).familles;
    expect(f!.tuteurs.map((t) => t.prenom)).toEqual(["Rita", "Paul"]);
    expect(f!.avertissements).toEqual([]);
    // Guardian 2 only: he becomes the main contact, so his missing number is reported.
    const [, houngbo] = analyser(
      fichier(
        "Agossou;Ayo;Agossou;1/2/2020;;Rita;Agossou;Mère;01 97 45 12 33",
        "Houngbo;Abla;Houngbo;1/2/2020;;;;;;Marc;Houngbo;Père;",
      ),
    ).familles;
    expect(houngbo!.avertissements).toEqual([
      { ligne: 3, message: "Tuteur 2 : aucun numéro, à compléter à la finalisation." },
    ]);
  });

  it("une famille sans tuteur est importée, avec un avertissement", () => {
    const analyse = analyser(fichier("Agossou;Ayo;Agossou;1/2/2020"));
    expect(analyse.familles[0]!.tuteurs).toEqual([]);
    expect(analyse.familles[0]!.avertissements[0]!.message).toBe(
      "Aucun tuteur : à compléter à la finalisation.",
    );
  });
});

describe("doublons possibles", () => {
  const existante: FamilleExistante = {
    id: "fam_1",
    nom: "Ahouansou",
    brouillon: false,
    prenomsEnfants: ["Grâce", "Daniel", "Élie"],
    telephones: ["+2290197451233"],
  };

  it("même téléphone de tuteur qu'une famille de l'église", () => {
    const [f] = analyser(fichier("Dossou;Ayo;Dossou;1/2/2020;;Rita;Dossou;Tante;01 97 45 12 33"), [
      existante,
    ]).familles;
    expect(f!.doublons).toEqual([
      {
        message: "Même téléphone de tuteur que la famille Ahouansou, déjà enregistrée.",
        familleId: "fam_1",
      },
    ]);
  });

  it("même nom de famille et mêmes prénoms d'enfants (brouillon compris)", () => {
    const [f] = analyser(fichier("AHOUANSOU;grace;Ahouansou;14/03/2019;;Rachel;Ahouansou;Mère;"), [
      { ...existante, brouillon: true, telephones: [] },
    ]).familles;
    expect(f!.doublons[0]!.message).toBe(
      "Même nom de famille et mêmes prénoms d'enfants que la famille Ahouansou (à compléter), déjà enregistrée.",
    );
  });

  it("dans le fichier : la seconde famille est signalée, pas la première", () => {
    const analyse = analyser(
      fichier(
        "Dossou;Ayo;Dossou;1/2/2020;;Rita;Dossou;Mère;01 97 45 12 33",
        "Dossou-Akpo;Koffi;Dossou;1/2/2018;;Rita;Dossou;Mère;01 97 45 12 33",
        "Agossou;Abla;Agossou;1/2/2017;;Marc;Agossou;Père;01 66 77 88 99",
        "Agossou;Abla;Agossou;1/2/2017;;Marc;Agossou;Père;",
      ),
    );
    expect(analyse.familles.map((f) => f.doublons.map((d) => d.ref))).toEqual([
      [],
      ["F1"],
      [],
      ["F3"],
    ]);
    expect(analyse.familles[1]!.doublons[0]!.message).toBe(
      "Même téléphone de tuteur que la famille Dossou du fichier (ligne 2).",
    );
  });

  it("un doublon possible n'est importé que s'il est coché", () => {
    const analyse = analyser(
      fichier("Dossou;Ayo;Dossou;1/2/2020;;Rita;Dossou;Tante;01 97 45 12 33"),
      [existante],
    );
    expect(appliquerChoix(analyse, { corrections: [], doublons: [] })).toMatchObject({
      aCreer: [],
      ecartees: [{ ref: "F1" }],
    });
    expect(appliquerChoix(analyse, { corrections: [], doublons: ["F1"] }).aCreer).toHaveLength(1);
  });
});

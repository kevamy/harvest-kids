/**
 * CSV reading (ADR 0013): encodings (UTF-8 with and without BOM, Windows-1252), both
 * separators, quoted fields, line breaks inside a field, refusals with a message.
 */
import { describe, expect, it } from "vitest";
import {
  BOM,
  CsvIllisible,
  analyserCsv,
  decoderTexte,
  detecterSeparateur,
  ecrireCsv,
  type Separateur,
} from "@/lib/csv";

// Accents of French and Beninese names, and two characters specific to Windows-1252
// (right quote 0x92, "œ" 0x9C) that Latin-1 does not have.
const LIGNES = [
  ["Nom de famille", "Prénom de l'enfant", "Lien tuteur 1"],
  ["Hounkpè", "Éloïse", "Mère d’accueil"],
  ["Agossou-Dégbé", "Grâce, Noël", "Sœur aînée"],
];

const UTF8 = (texte: string) => new TextEncoder().encode(texte);
const WINDOWS_1252: Record<string, number> = { "’": 0x92, œ: 0x9c };
function enWindows1252(texte: string): Uint8Array {
  return Uint8Array.from(
    [...texte].map((c) => {
      const code = WINDOWS_1252[c] ?? c.charCodeAt(0);
      if (code > 0xff) throw new Error(`Caractère hors Windows-1252 : ${c}`);
      return code;
    }),
  );
}

const ENCODAGES = [
  ["utf-8-bom", (t: string) => UTF8(BOM + t)],
  ["utf-8", UTF8],
  ["windows-1252", enWindows1252],
] as const;

describe("lecture d'un fichier accentué", () => {
  for (const [encodage, encoder] of ENCODAGES) {
    for (const separateur of [";", ","] as Separateur[]) {
      it(`${encodage}, séparateur « ${separateur} »`, () => {
        const octets = encoder(ecrireCsv(LIGNES, separateur));
        const decode = decoderTexte(octets);
        expect(decode.encodage).toBe(encodage);
        expect(detecterSeparateur(decode.texte)).toBe(separateur);
        const lu = analyserCsv(decode.texte, separateur);
        expect(lu.map((e) => e.champs)).toEqual(LIGNES);
        expect(lu.map((e) => e.ligne)).toEqual([1, 2, 3]);
      });
    }
  }

  it("une séquence UTF-8 invalide fait basculer en Windows-1252", () => {
    expect(decoderTexte(Uint8Array.from([0x41, 0xe9, 0x42])).texte).toBe("AéB");
  });

  it("Windows-1252 n'est pas Latin-1 : 0x80 à 0x9F sont des caractères imprimables", () => {
    // Euro, ellipsis, en dash, "œ", "Ÿ", French quotes (Latin-1 range).
    const octets = Uint8Array.from([0x80, 0x85, 0x96, 0x9c, 0x9f, 0xab, 0x20, 0xbb]);
    expect(decoderTexte(octets)).toEqual({ texte: "€…–œŸ« »", encodage: "windows-1252" });
  });

  it("refuse un fichier UTF-16 et un fichier UTF-8 avec BOM mais illisible", () => {
    expect(() => decoderTexte(Uint8Array.from([0xff, 0xfe, 0x41, 0x00]))).toThrow(
      /UTF-16.*CSV UTF-8/,
    );
    expect(() => decoderTexte(Uint8Array.from([0xef, 0xbb, 0xbf, 0xe9]))).toThrow(CsvIllisible);
  });
});

describe("analyse RFC 4180", () => {
  it("guillemets doublés, séparateur et retours à la ligne dans un champ, numéros de ligne", () => {
    const texte = 'a;b\r\n"Dupont ""Jojo""";"rue 1;\r\nporte 2"\r\nc;d\n\n"e";f';
    const lu = analyserCsv(texte, ";");
    expect(lu).toEqual([
      { ligne: 1, champs: ["a", "b"] },
      { ligne: 2, champs: ['Dupont "Jojo"', "rue 1;\r\nporte 2"] },
      { ligne: 4, champs: ["c", "d"] },
      { ligne: 6, champs: ["e", "f"] },
    ]);
  });

  it("garde un guillemet au milieu d'un champ, ignore les lignes vides et la fin de fichier", () => {
    expect(analyserCsv('a;b"c\n;\n\n', ";")).toEqual([{ ligne: 1, champs: ["a", 'b"c'] }]);
  });

  it("un guillemet jamais refermé est signalé avec sa ligne", () => {
    expect(() => analyserCsv('a;b\nc;"d\ne;f', ";")).toThrow(
      "Ligne 2 : un guillemet ouvert n'est jamais refermé.",
    );
  });

  it("le séparateur se détecte sur la première ligne, hors guillemets", () => {
    expect(detecterSeparateur('"a;b;c",d,e\n1;2;3;4;5')).toBe(",");
    expect(detecterSeparateur("a;b,c;d")).toBe(";");
    expect(() => detecterSeparateur("une seule colonne\n1")).toThrow(CsvIllisible);
  });

  it("ecrireCsv met entre guillemets seulement ce qui en a besoin", () => {
    expect(ecrireCsv([["a", "b;c", 'd"e', "f\ng"]])).toBe('a;"b;c";"d""e";"f\ng"\r\n');
  });
});

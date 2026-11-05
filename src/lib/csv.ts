/**
 * CSV reading and writing (RFC 4180), without dependency (ADR 0013). Used by the family
 * import: files come from spreadsheets (Excel, LibreOffice, Google Sheets) or other tools.
 *
 * - Encoding: UTF-8 with or without BOM, otherwise Windows-1252 (Excel's "CSV" on a
 *   French Windows). UTF-8 is decoded strictly: any invalid sequence means Windows-1252.
 * - Separator: ";" or ",", detected on the header line, outside quotes.
 * - Quoted fields: doubled quotes, separators and line breaks inside a field.
 */

export type Encodage = "utf-8-bom" | "utf-8" | "windows-1252";
export type Separateur = ";" | ",";
export type Enregistrement = {
  /** Physical line where the record starts (1-based). */
  ligne: number;
  champs: string[];
};

/** File-level refusal, with the message to show (what to do). */
export class CsvIllisible extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvIllisible";
  }
}

export const BOM = "﻿";

// Windows-1252 differs from Latin-1 in 0x80-0x9F only. Node's TextDecoder("windows-1252")
// decodes as Latin-1 (these bytes become invisible control characters), hence this table.
// Undefined bytes (0x81, 0x8D, 0x8F, 0x90, 0x9D) keep their code point, as in WHATWG.
const WINDOWS_1252_80_9F = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x8d, 0x017d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc,
  0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

function decoderWindows1252(octets: Uint8Array): string {
  let texte = "";
  for (const octet of octets) {
    texte += String.fromCharCode(
      octet >= 0x80 && octet <= 0x9f ? WINDOWS_1252_80_9F[octet - 0x80]! : octet,
    );
  }
  return texte;
}

export function decoderTexte(octets: Uint8Array): { texte: string; encodage: Encodage } {
  if ((octets[0] === 0xff && octets[1] === 0xfe) || (octets[0] === 0xfe && octets[1] === 0xff)) {
    throw new CsvIllisible(
      "Ce fichier est en UTF-16 (« texte Unicode »). Enregistrez-le au format « CSV UTF-8 », puis recommencez.",
    );
  }
  const avecBom = octets[0] === 0xef && octets[1] === 0xbb && octets[2] === 0xbf;
  try {
    const texte = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      avecBom ? octets.subarray(3) : octets,
    );
    return { texte, encodage: avecBom ? "utf-8-bom" : "utf-8" };
  } catch {
    if (avecBom) {
      throw new CsvIllisible(
        "Ce fichier annonce l'encodage UTF-8 mais contient des caractères illisibles. Enregistrez-le de nouveau au format « CSV UTF-8 », puis recommencez.",
      );
    }
    return { texte: decoderWindows1252(octets), encodage: "windows-1252" };
  }
}

/** ";" or ",": the one that appears most on the first line, outside quotes. */
export function detecterSeparateur(texte: string): Separateur {
  let pointsVirgules = 0;
  let virgules = 0;
  let entreGuillemets = false;
  for (const caractere of texte) {
    if (caractere === '"') entreGuillemets = !entreGuillemets;
    else if (!entreGuillemets && (caractere === "\n" || caractere === "\r")) break;
    else if (!entreGuillemets && caractere === ";") pointsVirgules++;
    else if (!entreGuillemets && caractere === ",") virgules++;
  }
  if (pointsVirgules === 0 && virgules === 0) {
    throw new CsvIllisible(
      "La première ligne ne contient ni point-virgule ni virgule : ce n'est pas un fichier CSV en colonnes. Partez du modèle à télécharger.",
    );
  }
  return virgules > pointsVirgules ? "," : ";";
}

/**
 * Splits the text into records. A quote opens a quoted field only at the start of a
 * field; elsewhere it is kept as is. Empty records (blank lines) are dropped.
 */
export function analyserCsv(texte: string, separateur: Separateur): Enregistrement[] {
  const enregistrements: Enregistrement[] = [];
  let champs: string[] = [];
  let champ = "";
  let entreGuillemets = false;
  let debutChamp = true;
  let ligne = 1;
  let ligneEnregistrement = 1;
  let ligneGuillemet = 1;

  const finirChamp = () => {
    champs.push(champ);
    champ = "";
    debutChamp = true;
  };
  const finirEnregistrement = () => {
    finirChamp();
    if (champs.some((c) => c.trim() !== "")) {
      enregistrements.push({ ligne: ligneEnregistrement, champs });
    }
    champs = [];
  };

  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]!;
    if (entreGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') {
          champ += '"';
          i++;
        } else {
          entreGuillemets = false;
        }
      } else {
        if (c === "\n" || (c === "\r" && texte[i + 1] !== "\n")) ligne++;
        champ += c;
      }
      continue;
    }
    if (c === '"' && debutChamp) {
      entreGuillemets = true;
      debutChamp = false;
      ligneGuillemet = ligne;
    } else if (c === separateur) {
      finirChamp();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i++;
      finirEnregistrement();
      ligne++;
      ligneEnregistrement = ligne;
    } else {
      champ += c;
      debutChamp = false;
    }
  }
  if (entreGuillemets) {
    throw new CsvIllisible(
      `Ligne ${ligneGuillemet} : un guillemet ouvert n'est jamais refermé. Corrigez le fichier, puis recommencez.`,
    );
  }
  finirEnregistrement();
  return enregistrements;
}

/** Text to CSV: quotes a field only when it needs it; CRLF line ends (Excel). */
export function ecrireCsv(lignes: readonly (readonly string[])[], separateur: Separateur = ";") {
  const echapper = (champ: string) =>
    champ.includes(separateur) || /["\r\n]/.test(champ) ? `"${champ.replace(/"/g, '""')}"` : champ;
  return lignes.map((l) => l.map(echapper).join(separateur)).join("\r\n") + "\r\n";
}

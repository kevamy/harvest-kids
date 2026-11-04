/**
 * Phone numbers (tuteurs, authorised adults, church reception): stored in E.164, "+"
 * followed by digits only (+2290197451233), formatted for display. Shared by the browser
 * (immediate feedback) and the server (which always normalises again).
 *
 * One rule per country, easy to extend: national length, trunk prefix, and the former
 * numbering plan to convert after confirmation (Benin, since late 2024: 10 digits,
 * "01" followed by the former 8-digit number).
 */
export type RegleTelephone = {
  indicatif: string;
  pays: string;
  /** Digits after the country code. */
  longueurNationale: number;
  /** Trunk prefix dialled inside the country and dropped in E.164 (France "0"…). */
  prefixeInterurbain?: string;
  /** Former plan: a number of this length gets this prefix, after confirmation. */
  ancienFormat?: { longueur: number; prefixe: string };
};

export const REGLES_TELEPHONE: readonly RegleTelephone[] = [
  {
    indicatif: "229",
    pays: "Bénin",
    longueurNationale: 10,
    ancienFormat: { longueur: 8, prefixe: "01" },
  },
  { indicatif: "228", pays: "Togo", longueurNationale: 8 },
  { indicatif: "234", pays: "Nigeria", longueurNationale: 10, prefixeInterurbain: "0" },
  { indicatif: "225", pays: "Côte d'Ivoire", longueurNationale: 10 },
  { indicatif: "237", pays: "Cameroun", longueurNationale: 9 },
  { indicatif: "243", pays: "RD Congo", longueurNationale: 9, prefixeInterurbain: "0" },
  { indicatif: "33", pays: "France", longueurNationale: 9, prefixeInterurbain: "0" },
];

export const INDICATIF_PAR_DEFAUT = "229";

export type ResultatTelephone =
  | { statut: "valide"; e164: string }
  | { statut: "a_confirmer"; e164: string; proposition: string; message: string }
  | { statut: "invalide"; message: string };

const regle = (indicatif: string) => REGLES_TELEPHONE.find((r) => r.indicatif === indicatif);

/** Known country code at the start of international digits (longest match first). */
function decouper(chiffres: string): {
  regle?: RegleTelephone;
  indicatif: string;
  national: string;
} {
  const connue = [...REGLES_TELEPHONE]
    .sort((a, b) => b.indicatif.length - a.indicatif.length)
    .find((r) => chiffres.startsWith(r.indicatif));
  return connue
    ? {
        regle: connue,
        indicatif: connue.indicatif,
        national: chiffres.slice(connue.indicatif.length),
      }
    : { indicatif: "", national: chiffres };
}

const INVALIDE =
  "Ce numéro de téléphone n'est pas valide. Saisissez-le en entier, par exemple 01 97 45 12 33 ou +33 6 12 34 56 78.";

/**
 * Normalises a typed number. Accepted: spaces, dashes, dots, brackets, "+" or "00" for
 * an international number; without a country code, the church's default one applies.
 */
export function normaliserTelephone(
  saisie: string,
  indicatifParDefaut: string = INDICATIF_PAR_DEFAUT,
): ResultatTelephone {
  const brut = saisie.trim();
  if (!/^[+0-9 ().-]+$/.test(brut)) return { statut: "invalide", message: INVALIDE };
  const chiffres = brut.replace(/[^0-9]/g, "");
  const international = brut.startsWith("+") || chiffres.startsWith("00");

  let indicatif: string;
  let national: string;
  let regleDuPays: RegleTelephone | undefined;
  if (international) {
    const decoupe = decouper(brut.startsWith("+") ? chiffres : chiffres.slice(2));
    if (!decoupe.regle) {
      // Unknown country: E.164 allows 8 to 15 digits in all.
      const tout = decoupe.national;
      return tout.length >= 8 && tout.length <= 15
        ? { statut: "valide", e164: `+${tout}` }
        : { statut: "invalide", message: INVALIDE };
    }
    ({ indicatif, national, regle: regleDuPays } = decoupe);
  } else {
    regleDuPays = regle(indicatifParDefaut);
    indicatif = indicatifParDefaut;
    national = chiffres;
    if (regleDuPays?.prefixeInterurbain && national.startsWith(regleDuPays.prefixeInterurbain)) {
      national = national.slice(regleDuPays.prefixeInterurbain.length);
    }
  }

  if (!regleDuPays) {
    const tout = indicatif + national;
    return tout.length >= 8 && tout.length <= 15
      ? { statut: "valide", e164: `+${tout}` }
      : { statut: "invalide", message: INVALIDE };
  }
  if (national.length === regleDuPays.longueurNationale) {
    return { statut: "valide", e164: `+${indicatif}${national}` };
  }
  const ancien = regleDuPays.ancienFormat;
  if (ancien && national.length === ancien.longueur) {
    const e164 = `+${indicatif}${ancien.prefixe}${national}`;
    const proposition = formaterNational(`${ancien.prefixe}${national}`);
    return {
      statut: "a_confirmer",
      e164,
      proposition,
      message: `Ce numéro a ${ancien.longueur} chiffres. Voulez-vous dire ${proposition} ?`,
    };
  }
  return { statut: "invalide", message: INVALIDE };
}

/** Pairs of digits; an odd length starts with a single digit (France: 6 12 34 56 78). */
const formaterNational = (national: string) => {
  const tete = national.length % 2 === 1 ? national.slice(0, 1) : "";
  const paires = national.slice(tete.length).match(/\d{2}/g) ?? [];
  return [tete, ...paires].filter(Boolean).join(" ");
};

/** "+229 01 97 45 12 33" for display (pairs of digits after the country code). */
export function formaterTelephone(e164: string): string {
  if (!/^\+\d{8,15}$/.test(e164)) return e164;
  const { regle: connue, indicatif, national } = decouper(e164.slice(1));
  if (!connue) return e164;
  return `+${indicatif} ${formaterNational(national)}`;
}

/**
 * Digits to look for in stored numbers (search): the full E.164 digits when the input is a
 * complete number, otherwise the digits as typed (partial number, matched on the end).
 * Null under 6 digits: too short to be useful.
 */
export function chiffresRecherche(
  terme: string,
  indicatifParDefaut: string = INDICATIF_PAR_DEFAUT,
): string | null {
  const chiffres = terme.replace(/[^0-9]/g, "");
  if (chiffres.length < 6 || /[^+0-9 ().-]/.test(terme.trim())) return null;
  const normalise = normaliserTelephone(terme, indicatifParDefaut);
  return normalise.statut === "invalide" ? chiffres : normalise.e164.slice(1);
}

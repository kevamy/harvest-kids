import {
  CsvIllisible,
  analyserCsv,
  decoderTexte,
  detecterSeparateur,
  type Encodage,
  type Enregistrement,
  type Separateur,
} from "@/lib/csv";
import { normaliserTelephone } from "@/lib/telephone";

/**
 * Family import, pure part (cahier §7.1, ADR 0013): reading the file, line checks,
 * grouping of the children into families, numbers to confirm and possible duplicates.
 * No database access: the service gives the church's existing families and its default
 * country code, and applies the choices made on the preview.
 *
 * One line per child. Children with the same family name and the same guardian 1 phone
 * (or, without a usable phone, the same guardian 1 first and last name) form a family.
 * Only unusable lines are rejected: no child's name, birth date missing or invalid.
 */

export const TAILLE_MAX = 1024 * 1024;
export const LIGNES_MAX = 2000;
export const ENFANTS_MAX = 12;

/** Template columns, in order. Headers are matched without case, accents or order. */
export const COLONNES = [
  { cle: "famille", entete: "Nom de famille" },
  { cle: "enfantPrenom", entete: "Prénom de l'enfant" },
  { cle: "enfantNom", entete: "Nom de l'enfant" },
  { cle: "dateNaissance", entete: "Date de naissance" },
  { cle: "sexe", entete: "Sexe" },
  { cle: "t1Prenom", entete: "Prénom tuteur 1" },
  { cle: "t1Nom", entete: "Nom tuteur 1" },
  { cle: "t1Lien", entete: "Lien tuteur 1" },
  { cle: "t1Telephone", entete: "Téléphone tuteur 1" },
  { cle: "t2Prenom", entete: "Prénom tuteur 2" },
  { cle: "t2Nom", entete: "Nom tuteur 2" },
  { cle: "t2Lien", entete: "Lien tuteur 2" },
  { cle: "t2Telephone", entete: "Téléphone tuteur 2" },
] as const;
type Cle = (typeof COLONNES)[number]["cle"];

/** File-level refusal (size, columns, encoding), with the message to show. */
export class ImportRefuse extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportRefuse";
  }
}

/** Case, accents, punctuation and spaces ignored: "Prénom de l'enfant" = "prenom de l enfant". */
export function normaliser(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export type ResultatDate = { ok: true; date: string } | { ok: false; message: string };

const DATE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
// Day and month with or without a leading zero; a time added by a spreadsheet is ignored.
const DATE_FR = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d+)(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/;

/**
 * Birth date: DD/MM/YYYY (5/3/2019 too) or YYYY-MM-DD. Two-digit years are refused, as
 * are a date in the future and a child of 18 or more (same bounds as the form).
 */
export function lireDateNaissance(valeur: string, maintenant: Date): ResultatDate {
  const brut = valeur.trim();
  if (!brut) {
    return { ok: false, message: "Date de naissance manquante : ajoutez-la (JJ/MM/AAAA)." };
  }
  let annee: string;
  let mois: string;
  let jour: string;
  const iso = DATE_ISO.exec(brut);
  const fr = DATE_FR.exec(brut);
  if (iso) {
    [, annee, mois, jour] = iso as unknown as [string, string, string, string];
  } else if (fr) {
    [, jour, mois, annee] = fr as unknown as [string, string, string, string];
    if (annee.length === 2) {
      return {
        ok: false,
        message: `Date de naissance « ${brut} » avec une année sur deux chiffres : saisissez l'année complète, par exemple 05/03/2019.`,
      };
    }
  } else {
    return {
      ok: false,
      message: `Date de naissance « ${brut} » illisible : utilisez le format JJ/MM/AAAA, par exemple 05/03/2019.`,
    };
  }
  const a = Number(annee);
  const m = Number(mois);
  const j = Number(jour);
  const date = new Date(Date.UTC(a, m - 1, j));
  if (
    annee.length !== 4 ||
    date.getUTCFullYear() !== a ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== j
  ) {
    return {
      ok: false,
      message: `Date de naissance « ${brut} » impossible : vérifiez le jour et le mois (JJ/MM/AAAA).`,
    };
  }
  if (date > maintenant) {
    return { ok: false, message: `Date de naissance « ${brut} » dans le futur : corrigez-la.` };
  }
  const limite = new Date(maintenant);
  limite.setUTCFullYear(limite.getUTCFullYear() - 18);
  if (date < limite) {
    return {
      ok: false,
      message: `Date de naissance « ${brut} » : l'enfant aurait 18 ans ou plus. Vérifiez la date.`,
    };
  }
  return { ok: true, date: date.toISOString().slice(0, 10) };
}

const SEXES: Record<string, "F" | "M"> = {
  f: "F",
  fille: "F",
  feminin: "F",
  m: "M",
  g: "M",
  garcon: "M",
  masculin: "M",
};

/** Phone of a guardian in the file, as read. */
export type TelephoneLu =
  | { statut: "valide"; e164: string }
  | { statut: "a_confirmer"; saisi: string; e164: string; proposition: string }
  | { statut: "illisible"; saisi: string }
  | { statut: "absent" };

function lireTelephone(valeur: string, indicatif: string): TelephoneLu {
  const saisi = valeur.trim();
  if (!saisi) return { statut: "absent" };
  const resultat = normaliserTelephone(saisi, indicatif);
  if (resultat.statut === "valide") return { statut: "valide", e164: resultat.e164 };
  if (resultat.statut === "a_confirmer") {
    return { statut: "a_confirmer", saisi, e164: resultat.e164, proposition: resultat.proposition };
  }
  return { statut: "illisible", saisi };
}

/** E.164 number of a phone that can identify a family (valid, or proposed correction). */
const numero = (t: TelephoneLu) =>
  t.statut === "valide" || t.statut === "a_confirmer" ? t.e164 : null;

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type TuteurImporte = { prenom: string; nom: string; lien: string; telephone: TelephoneLu };
export type EnfantImporte = {
  prenom: string;
  nom: string;
  /** YYYY-MM-DD */
  dateNaissance: string;
  sexe: "F" | "M" | null;
};
export type Remarque = {
  ligne: number;
  message: string;
  /** To check before importing (a name taken from another column): highlighted. */
  important?: true;
};
export type Doublon = {
  message: string;
  /** Existing family of the church (link to its record), or a family of the same file. */
  familleId?: string;
  ref?: string;
};

export type FamilleImportee = {
  /** Identifier inside this file ("F1", "F2"…), stable for the same bytes. */
  ref: string;
  nom: string;
  lignes: number[];
  /** Guardian 1 then guardian 2; empty when the file names none. */
  tuteurs: TuteurImporte[];
  enfants: EnfantImporte[];
  avertissements: Remarque[];
  /** Possible duplicates: left out unless "Importer quand même" is ticked. */
  doublons: Doublon[];
};

export type AnalyseImport = {
  encodage: Encodage;
  separateur: Separateur;
  /** Data lines read (blank lines excluded). */
  lignesLues: number;
  colonnesIgnorees: string[];
  /** Whole-file points to check (a name column missing): highlighted. */
  remarques: string[];
  familles: FamilleImportee[];
  rejets: Remarque[];
};

/** Existing family of the church, for duplicate detection. */
export type FamilleExistante = {
  id: string;
  nom: string;
  brouillon: boolean;
  prenomsEnfants: string[];
  telephones: string[];
};

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function lireEntetes(entetes: string[]): { index: Map<Cle, number>; ignorees: string[] } {
  const index = new Map<Cle, number>();
  const ignorees: string[] = [];
  entetes.forEach((brut, i) => {
    const entete = normaliser(brut);
    if (!entete) return;
    const colonne = COLONNES.find((c) => normaliser(c.entete) === entete);
    if (!colonne) {
      ignorees.push(brut.trim());
      return;
    }
    if (index.has(colonne.cle)) {
      throw new ImportRefuse(
        `La colonne « ${colonne.entete} » apparaît deux fois. Gardez-en une seule, puis recommencez.`,
      );
    }
    index.set(colonne.cle, i);
  });
  const manquantes = COLONNES.filter(
    (c) => (c.cle === "enfantPrenom" || c.cle === "dateNaissance") && !index.has(c.cle),
  ).map((c) => c.entete);
  if (!index.has("famille") && !index.has("enfantNom")) {
    manquantes.push("Nom de famille");
  }
  if (manquantes.length > 0) {
    throw new ImportRefuse(
      `Colonnes manquantes : ${manquantes.map((m) => `« ${m} »`).join(", ")}. Téléchargez le modèle pour voir les colonnes attendues, puis recommencez.`,
    );
  }
  return { index, ignorees };
}

type LigneLue = {
  ligne: number;
  famille: string;
  enfant: EnfantImporte;
  tuteurs: (TuteurImporte | null)[];
  avertissements: Remarque[];
};

function lireLigne(
  enregistrement: Enregistrement,
  index: Map<Cle, number>,
  indicatif: string,
  maintenant: Date,
): LigneLue | Remarque {
  const { ligne, champs } = enregistrement;
  const valeur = (cle: Cle) => {
    const i = index.get(cle);
    return i === undefined ? "" : (champs[i] ?? "").trim();
  };
  const prenom = valeur("enfantPrenom");
  const nomFamille = valeur("famille");
  const nomEnfant = valeur("enfantNom");
  const famille = nomFamille || nomEnfant;
  if (!prenom || !famille) {
    return {
      ligne,
      message: "Nom de l'enfant manquant : ajoutez son prénom et son nom (ou le nom de famille).",
    };
  }
  const date = lireDateNaissance(valeur("dateNaissance"), maintenant);
  if (!date.ok) return { ligne, message: date.message };

  const avertissements: Remarque[] = [];
  // A name taken from the other column must be checked by the person importing (shown
  // highlighted). A whole missing column is reported once for the file instead.
  if (!nomFamille && index.has("famille")) {
    avertissements.push({
      ligne,
      important: true,
      message: `Nom de famille absent : repris du nom de l'enfant (« ${nomEnfant} »). Vérifiez-le.`,
    });
  }
  if (!nomEnfant && index.has("enfantNom")) {
    avertissements.push({
      ligne,
      important: true,
      message: `Nom de l'enfant absent : repris du nom de famille (« ${nomFamille} »). Vérifiez-le.`,
    });
  }
  const sexeSaisi = valeur("sexe");
  const sexe = sexeSaisi ? (SEXES[normaliser(sexeSaisi)] ?? null) : null;
  if (sexeSaisi && !sexe) {
    avertissements.push({
      ligne,
      message: `Sexe « ${sexeSaisi} » non reconnu (F ou M) : à préciser à la finalisation.`,
    });
  }

  const tuteur = (n: 1 | 2): TuteurImporte | null => {
    const champ = (suffixe: "Prenom" | "Nom" | "Lien" | "Telephone") =>
      valeur(`t${n}${suffixe}` as Cle);
    const lu = {
      prenom: champ("Prenom"),
      nom: champ("Nom"),
      lien: champ("Lien"),
      telephone: lireTelephone(champ("Telephone"), indicatif),
    };
    return !lu.prenom && !lu.nom && !lu.lien && lu.telephone.statut === "absent" ? null : lu;
  };

  return {
    ligne,
    famille,
    enfant: { prenom, nom: nomEnfant || famille, dateNaissance: date.date, sexe },
    tuteurs: [tuteur(1), tuteur(2)],
    avertissements,
  };
}

/**
 * Grouping key: family name, then guardian 1's phone (valid or proposed correction) or,
 * without one, guardian 1's first and last name.
 */
function cleFamille(l: LigneLue): string {
  const t1 = l.tuteurs[0];
  const tel = t1 ? numero(t1.telephone) : null;
  const identite = tel
    ? `tel:${tel}`
    : `nom:${normaliser(t1?.prenom ?? "")}|${normaliser(t1?.nom ?? "")}`;
  return `${normaliser(l.famille)}#${identite}`;
}

// A number to confirm and the same number typed in full are the same number.
const cleTelephone = (t: TelephoneLu) =>
  numero(t) ?? (t.statut === "illisible" ? normaliser(t.saisi) : "");

const memeTuteur = (a: TuteurImporte, b: TuteurImporte) =>
  normaliser(a.prenom) === normaliser(b.prenom) &&
  normaliser(a.nom) === normaliser(b.nom) &&
  normaliser(a.lien) === normaliser(b.lien) &&
  cleTelephone(a.telephone) === cleTelephone(b.telephone);

/** Either set of first names includes the other (an existing family may have more children). */
function memesPrenoms(a: string[], b: string[]): boolean {
  const x = new Set(a.map(normaliser));
  const y = new Set(b.map(normaliser));
  if (x.size === 0 || y.size === 0) return false;
  return [...x].every((p) => y.has(p)) || [...y].every((p) => x.has(p));
}

const telephonesDe = (f: FamilleImportee) =>
  f.tuteurs.flatMap((t) => {
    const n = numero(t.telephone);
    return n ? [n] : [];
  });

function chercherDoublons(familles: FamilleImportee[], existantes: FamilleExistante[]) {
  const prenoms = (f: FamilleImportee) => f.enfants.map((e) => e.prenom);
  const tuteur1 = (f: FamilleImportee) => {
    const t = f.tuteurs[0];
    const nom = t ? normaliser(`${t.prenom} ${t.nom}`) : "";
    return nom || null;
  };
  for (const [j, f] of familles.entries()) {
    const telephones = telephonesDe(f);
    for (const e of existantes) {
      const libelle = `la famille ${e.nom}${e.brouillon ? " (à compléter)" : ""}, déjà enregistrée`;
      if (telephones.some((t) => e.telephones.includes(t))) {
        f.doublons.push({ message: `Même téléphone de tuteur que ${libelle}.`, familleId: e.id });
      } else if (
        normaliser(f.nom) === normaliser(e.nom) &&
        memesPrenoms(prenoms(f), e.prenomsEnfants)
      ) {
        f.doublons.push({
          message: `Même nom de famille et mêmes prénoms d'enfants que ${libelle}.`,
          familleId: e.id,
        });
      }
    }
    // Inside the file: a later family is compared with the earlier ones.
    for (const autre of familles.slice(0, j)) {
      const libelle = `la famille ${autre.nom} du fichier (ligne ${autre.lignes[0]})`;
      const memeNom = normaliser(f.nom) === normaliser(autre.nom);
      if (telephones.some((t) => telephonesDe(autre).includes(t))) {
        f.doublons.push({ message: `Même téléphone de tuteur que ${libelle}.`, ref: autre.ref });
      } else if (memeNom && memesPrenoms(prenoms(f), prenoms(autre))) {
        f.doublons.push({
          message: `Même nom de famille et mêmes prénoms d'enfants que ${libelle}.`,
          ref: autre.ref,
        });
      } else if (memeNom && tuteur1(f) !== null && tuteur1(f) === tuteur1(autre)) {
        f.doublons.push({
          message: `Même nom de famille et même tuteur 1 que ${libelle}.`,
          ref: autre.ref,
        });
      }
    }
  }
}

/**
 * Reads and checks a whole file. Throws ImportRefuse for a file that cannot be used at
 * all; otherwise every line ends in a family or in the rejects, with its line number.
 */
export function analyserFichier(
  octets: Uint8Array,
  options: { indicatif: string; maintenant: Date; existantes: FamilleExistante[] },
): AnalyseImport {
  if (octets.byteLength === 0) {
    throw new ImportRefuse("Le fichier est vide. Partez du modèle à télécharger.");
  }
  if (octets.byteLength > TAILLE_MAX) {
    throw new ImportRefuse("Le fichier dépasse 1 Mo : découpez-le en plusieurs fichiers.");
  }
  let encodage: Encodage;
  let separateur: Separateur;
  let enregistrements: Enregistrement[];
  try {
    const decode = decoderTexte(octets);
    encodage = decode.encodage;
    separateur = detecterSeparateur(decode.texte);
    enregistrements = analyserCsv(decode.texte, separateur);
  } catch (erreur) {
    if (erreur instanceof CsvIllisible) throw new ImportRefuse(erreur.message);
    throw erreur;
  }
  const [entete, ...donnees] = enregistrements;
  if (!entete || donnees.length === 0) {
    throw new ImportRefuse(
      "Le fichier ne contient aucune ligne d'enfant sous la ligne des titres. Complétez-le, puis recommencez.",
    );
  }
  if (donnees.length > LIGNES_MAX) {
    throw new ImportRefuse(
      `Le fichier dépasse ${LIGNES_MAX.toLocaleString("fr-FR")} lignes : découpez-le en plusieurs fichiers.`,
    );
  }
  const { index, ignorees } = lireEntetes(entete.champs);

  const rejets: Remarque[] = [];
  const groupes = new Map<string, FamilleImportee>();
  const lignesDesEnfants = new Map<string, number[]>();
  const lignesDesTuteurs = new Map<string, number[]>();
  for (const enregistrement of donnees) {
    const lue = lireLigne(enregistrement, index, options.indicatif, options.maintenant);
    if (!("enfant" in lue)) {
      rejets.push(lue);
      continue;
    }
    const cle = cleFamille(lue);
    let famille = groupes.get(cle);
    if (!famille) {
      famille = {
        ref: `F${groupes.size + 1}`,
        nom: lue.famille,
        lignes: [],
        tuteurs: [],
        enfants: [],
        avertissements: [],
        doublons: [],
      };
      groupes.set(cle, famille);
    }

    const deja = famille.enfants.findIndex(
      (e) =>
        normaliser(e.prenom) === normaliser(lue.enfant.prenom) &&
        e.dateNaissance === lue.enfant.dateNaissance,
    );
    const lignesEnfants = lignesDesEnfants.get(famille.ref) ?? [];
    lignesDesEnfants.set(famille.ref, lignesEnfants);
    if (deja >= 0) {
      famille.lignes.push(lue.ligne);
      famille.avertissements.push({
        ligne: lue.ligne,
        message: `${lue.enfant.prenom} figure déjà dans cette famille (ligne ${lignesEnfants[deja]}) : importé une seule fois.`,
      });
      continue;
    }
    if (famille.enfants.length >= ENFANTS_MAX) {
      rejets.push({
        ligne: lue.ligne,
        message: `La famille ${famille.nom} compte déjà ${ENFANTS_MAX} enfants dans le fichier : vérifiez le nom de famille et le téléphone du tuteur 1.`,
      });
      continue;
    }
    famille.lignes.push(lue.ligne);
    lignesEnfants.push(lue.ligne);
    famille.enfants.push(lue.enfant);
    famille.avertissements.push(...lue.avertissements);

    // Guardians: the first line that names one is kept; a different one is reported.
    const lignesTuteurs = lignesDesTuteurs.get(famille.ref) ?? [];
    lignesDesTuteurs.set(famille.ref, lignesTuteurs);
    lue.tuteurs.forEach((t, i) => {
      if (!t) return;
      const retenu = famille.tuteurs[i];
      if (!retenu) {
        famille.tuteurs[i] = t;
        lignesTuteurs[i] = lue.ligne;
      } else if (!memeTuteur(retenu, t)) {
        famille.avertissements.push({
          ligne: lue.ligne,
          message: `Tuteur ${i + 1} différent de celui de la ligne ${lignesTuteurs[i]} : celui de la ligne ${lignesTuteurs[i]} est retenu.`,
        });
      }
    });
  }

  // Once per guardian kept (not once per child line): numbers to complete at finalisation.
  // Only the main contact (the first guardian named) must have one; another guardian may not.
  const familles = [...groupes.values()].map((f) => {
    const lignesTuteurs = lignesDesTuteurs.get(f.ref) ?? [];
    const avertissements = [...f.avertissements];
    const rangPrincipal = f.tuteurs.findIndex(Boolean);
    f.tuteurs.forEach((t, i) => {
      if (!t) return;
      const ligne = lignesTuteurs[i] ?? f.lignes[0]!;
      if (t.telephone.statut === "illisible") {
        avertissements.push({
          ligne,
          message: `Tuteur ${i + 1} : numéro illisible (« ${t.telephone.saisi} »), à corriger à la finalisation.`,
        });
      } else if (t.telephone.statut === "absent" && i === rangPrincipal) {
        avertissements.push({
          ligne,
          message: `Tuteur ${i + 1} : aucun numéro, à compléter à la finalisation.`,
        });
      }
    });
    if (!f.tuteurs.some(Boolean)) {
      avertissements.push({
        ligne: f.lignes[0]!,
        message: "Aucun tuteur : à compléter à la finalisation.",
      });
    }
    return {
      ...f,
      tuteurs: f.tuteurs.filter(Boolean),
      avertissements: avertissements.sort((x, y) => x.ligne - y.ligne),
    };
  });
  chercherDoublons(familles, options.existantes);
  return {
    encodage,
    separateur,
    lignesLues: donnees.length,
    colonnesIgnorees: ignorees,
    remarques: [
      ...(index.has("famille")
        ? []
        : [
            "La colonne « Nom de famille » est absente : le nom de l'enfant sert de nom de famille. Vérifiez les noms ci-dessous.",
          ]),
      ...(index.has("enfantNom")
        ? []
        : [
            "La colonne « Nom de l'enfant » est absente : chaque enfant prend le nom de famille. Vérifiez les noms ci-dessous.",
          ]),
    ],
    familles,
    rejets: rejets.sort((x, y) => x.ligne - y.ligne),
  };
}

// ---------------------------------------------------------------------------
// Choices made on the preview
// ---------------------------------------------------------------------------

/** Identifier of a number to confirm: family ref and guardian rank ("F3-t1"). */
export const idCorrection = (ref: string, rang: number) => `${ref}-t${rang + 1}`;

export type BrouillonImporte = {
  ref: string;
  nom: string;
  tuteurs: {
    prenom: string;
    nom: string;
    lien: string;
    telephone: string | null;
    principal: boolean;
  }[];
  enfants: { prenom: string; nom: string; dateNaissance: Date; sexe: "F" | "M" | null }[];
  /** Numbers left empty because their correction was not validated. */
  nonValides: string[];
};

export type Choix = { corrections: readonly string[]; doublons: readonly string[] };

/**
 * Applies the preview choices: a possible duplicate is imported only when ticked; a
 * number to confirm is stored only when its correction is validated, otherwise the
 * guardian is imported without it.
 */
export function appliquerChoix(analyse: AnalyseImport, choix: Choix) {
  const corrections = new Set(choix.corrections);
  const doublons = new Set(choix.doublons);
  const aCreer: BrouillonImporte[] = [];
  const ecartees: FamilleImportee[] = [];
  for (const f of analyse.familles) {
    if (f.doublons.length > 0 && !doublons.has(f.ref)) {
      ecartees.push(f);
      continue;
    }
    const nonValides: string[] = [];
    aCreer.push({
      ref: f.ref,
      nom: f.nom,
      tuteurs: f.tuteurs.map((t, rang) => {
        let telephone: string | null = null;
        if (t.telephone.statut === "valide") telephone = t.telephone.e164;
        else if (t.telephone.statut === "a_confirmer") {
          if (corrections.has(idCorrection(f.ref, rang))) telephone = t.telephone.e164;
          else nonValides.push(idCorrection(f.ref, rang));
        }
        return { prenom: t.prenom, nom: t.nom, lien: t.lien, telephone, principal: rang === 0 };
      }),
      enfants: f.enfants.map((e) => ({
        ...e,
        dateNaissance: new Date(`${e.dateNaissance}T00:00:00Z`),
      })),
      nonValides,
    });
  }
  return { aCreer, ecartees };
}

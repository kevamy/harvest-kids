import "server-only";
import { Font } from "@react-pdf/renderer";
import { FORMATS, type FormatCarte } from "./formats";
import { MM_EN_POINTS, calculerGabarit, zoneVerso } from "./planche";
import { piedDe, type EgliseImpression } from "./pdf-carte";
import { TEXTES_CARTE_PAR_DEFAUT, TYPO, ligneTelephone, nomBadge } from "./textes";

/**
 * Fit check of the card texts: measures each line with the real font metrics of the
 * embedded TTF fonts (the ones react-pdf prints with) and the same sizes as the PDF
 * (TYPO), then compares the height needed with the zone of each format.
 */
type PoliceFontkit = {
  unitsPerEm: number;
  layout: (texte: string) => { advanceWidth: number };
};
type SourcePolice = { load: () => Promise<void>; data: PoliceFontkit | null };

async function police(famille: "Nunito" | "Fredoka", poids: number): Promise<PoliceFontkit> {
  const source = (Font as unknown as { getFont: (d: object) => SourcePolice }).getFont({
    fontFamily: famille,
    fontWeight: poids,
  });
  await source.load();
  return source.data!;
}

/** Lines needed by a paragraph wrapped word by word in `largeurPt`. */
export async function nombreLignes(
  texte: string,
  famille: "Nunito" | "Fredoka",
  poids: number,
  taille: number,
  largeurPt: number,
): Promise<number> {
  const p = await police(famille, poids);
  const largeur = (t: string) => (p.layout(t).advanceWidth / p.unitsPerEm) * taille;
  let lignes = 1;
  let ligne = "";
  for (const mot of texte.split(/\s+/).filter(Boolean)) {
    const essai = ligne ? `${ligne} ${mot}` : mot;
    if (largeur(essai) <= largeurPt || !ligne) {
      ligne = essai;
    } else {
      lignes++;
      ligne = mot;
    }
  }
  return lignes;
}

export type DepassementTexte = { format: FormatCarte["id"]; zone: "pied" | "verso" | "nom" };

/**
 * Type size of a monitor's name on a badge: the base size of the format, lowered by half
 * points down to `TYPO.badge.nomMin` until the mention and the (shortened) name fit the
 * text zone. Null when even the smallest size does not fit.
 */
export async function corpsNomBadge(
  nom: string,
  format: Pick<FormatCarte, "largeurMm" | "hauteurMm" | "orientation">,
  rectoSeul: boolean,
): Promise<number | null> {
  const b = TYPO.badge;
  const portrait = format.orientation === "portrait";
  const mention = portrait ? b.mention.portrait : b.mention.paysage;
  const zone = calculerGabarit(format, rectoSeul).texte;
  for (let corps = portrait ? b.nom.portrait : b.nom.paysage; corps >= b.nomMin; corps -= 0.5) {
    const lignes = await nombreLignes(
      nomBadge(nom),
      "Fredoka",
      600,
      corps,
      zone.largeur * MM_EN_POINTS,
    );
    if ((mention + corps * lignes) * TYPO.interligne <= zone.hauteur * MM_EN_POINTS) return corps;
  }
  return null;
}

/** Formats where a monitor's name would not fit, front only or both sides (empty: all fit). */
export async function verifierNomBadge(nom: string): Promise<DepassementTexte[]> {
  const depassements: DepassementTexte[] = [];
  for (const format of FORMATS) {
    for (const rectoSeul of [true, false]) {
      if ((await corpsNomBadge(nom, format, rectoSeul)) === null) {
        depassements.push({ format: format.id, zone: "nom" });
        break;
      }
    }
  }
  return depassements;
}

/** Zones whose text would leave its space, in any of the five formats (empty: all fit). */
export async function verifierTextesCarte(eglise: EgliseImpression): Promise<DepassementTexte[]> {
  const depassements: DepassementTexte[] = [];
  const textes = eglise.textes ?? TEXTES_CARTE_PAR_DEFAUT;
  const v = TYPO.verso;
  const hauteurLigne = (taille: number, lignes: number) => taille * TYPO.interligne * lignes;

  for (const format of FORMATS) {
    const portrait = format.orientation === "portrait";
    const recto = calculerGabarit(format, true);
    const taillePied = portrait ? TYPO.pied.portrait : TYPO.pied.paysage;
    const lignesPied = await nombreLignes(
      piedDe(eglise),
      "Nunito",
      400,
      taillePied,
      recto.pied!.largeur * MM_EN_POINTS,
    );
    if (hauteurLigne(taillePied, lignesPied) > recto.pied!.hauteur * MM_EN_POINTS) {
      depassements.push({ format: format.id, zone: "pied" });
    }

    const zone = zoneVerso(calculerGabarit(format, false));
    const largeur = zone.largeur * MM_EN_POINTS;
    let hauteur =
      hauteurLigne(
        v.titre,
        await nombreLignes(textes.titreVerso, "Fredoka", 600, v.titre, largeur),
      ) + v.ecart;
    for (const consigne of textes.consignesVerso) {
      hauteur +=
        hauteurLigne(v.consigne, await nombreLignes(consigne, "Nunito", 400, v.consigne, largeur)) +
        v.ecart;
    }
    const telephone = ligneTelephone(textes, eglise.telephoneAccueil);
    if (telephone) {
      hauteur += hauteurLigne(
        v.telephone,
        await nombreLignes(telephone, "Nunito", 700, v.telephone, largeur),
      );
    }
    hauteur +=
      v.ecart + hauteurLigne(v.nom, await nombreLignes(eglise.nom, "Nunito", 400, v.nom, largeur));
    if (hauteur > zone.hauteur * MM_EN_POINTS)
      depassements.push({ format: format.id, zone: "verso" });
  }
  return depassements;
}

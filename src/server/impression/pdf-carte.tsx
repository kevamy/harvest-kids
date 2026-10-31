import "server-only";
import { join } from "node:path";
import {
  Document,
  Font,
  Image,
  Line,
  Page,
  Rect,
  Svg,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { COULEURS_HORS_CSS as C } from "@/lib/couleurs";
import type { FormatCarte } from "./formats";
import {
  A4,
  FOND_PERDU_MM,
  TRAIT_COUPE,
  calculerGabarit,
  disposerPlanche,
  MM_EN_POINTS,
  positionsVerso,
  zoneVerso,
  type Gabarit,
} from "./planche";
import { matriceQr } from "./qr";
import {
  TEXTES_CARTE_PAR_DEFAUT,
  TYPO,
  ligneTelephone,
  textePied,
  type TextesCarte,
} from "./textes";

/**
 * Printed cards (cahier §7.10, RG-02): the church's logo, never Harvest Kids'. Fonts are
 * embedded from TTF files traced into the standalone build (next.config.ts); the clear
 * token only exists in this PDF.
 */
const POLICES = join(process.cwd(), "src", "server", "impression", "polices");
Font.register({ family: "Fredoka", src: join(POLICES, "Fredoka-SemiBold.ttf"), fontWeight: 600 });
Font.register({
  family: "Nunito",
  fonts: [
    { src: join(POLICES, "Nunito-Regular.ttf"), fontWeight: 400 },
    { src: join(POLICES, "Nunito-Bold.ttf"), fontWeight: 700 },
  ],
});
// French text is never hyphenated on a card.
Font.registerHyphenationCallback((mot) => [mot]);

export type ContenuCarte = {
  jeton: string;
  famille: string;
  enfants: { prenom: string; matricule: string }[];
};

export type EgliseImpression = {
  nom: string;
  /** PNG logo for light backgrounds, or null: the name is then set in Fredoka. */
  logo: Buffer | null;
  telephoneAccueil: string | null;
  /** Card texts of the church (Paramètres › Impression); defaults when absent. */
  textes?: TextesCarte;
};

export type OptionsImpression = {
  format: FormatCarte;
  rectoVerso: boolean;
  /** "unitaire": one card per page at its exact size (PVC printers); "planche": A4 sheet. */
  sortie: "unitaire" | "planche";
  /** Test card: marked "Essai", its token is not registered anywhere. */
  essai?: boolean;
};

const mm = (valeur: number) => `${valeur}mm`;
const textesDe = (eglise: EgliseImpression) => eglise.textes ?? TEXTES_CARTE_PAR_DEFAUT;

/** Front footer of a church's cards (see textes.ts). */
export const piedDe = (eglise: EgliseImpression) =>
  textePied(textesDe(eglise), eglise.telephoneAccueil);

/** Children shown on a card; beyond what fits, "+ n autres". */
function lignesEnfants(enfants: ContenuCarte["enfants"], gabarit: Gabarit) {
  const hauteurLigne = ((gabarit.corpsMatricule * 25.4) / 72) * 1.3;
  const max = Math.max(1, Math.floor((gabarit.texte.hauteur - 5) / hauteurLigne));
  if (enfants.length <= max) return { affiches: enfants, reste: 0 };
  return { affiches: enfants.slice(0, max - 1), reste: enfants.length - (max - 1) };
}

function Qr({ jeton, gabarit }: { jeton: string; gabarit: Gabarit }) {
  const matrice = matriceQr(jeton);
  return (
    <Svg
      viewBox={`0 0 ${matrice.total} ${matrice.total}`}
      style={{
        position: "absolute",
        left: mm(gabarit.qr.x),
        top: mm(gabarit.qr.y),
        width: mm(gabarit.qr.largeur),
        height: mm(gabarit.qr.hauteur),
      }}
    >
      <Rect x={0} y={0} width={matrice.total} height={matrice.total} fill={C.blanc} />
      {matrice.segments.map((s, i) => (
        <Rect key={i} x={s.x} y={s.y} width={s.longueur} height={1} fill={C.nuit} />
      ))}
    </Svg>
  );
}

function Recto({
  carte,
  eglise,
  gabarit,
  options,
  fondPerdu,
}: {
  carte: ContenuCarte;
  eglise: EgliseImpression;
  gabarit: Gabarit;
  options: OptionsImpression;
  fondPerdu: number;
}) {
  const { affiches, reste } = lignesEnfants(carte.enfants, gabarit);
  const portrait = options.format.orientation === "portrait";
  const b = gabarit.bandeau;
  return (
    <>
      {/* Header strip, run into the bleed on the top and sides. */}
      <View
        style={{
          position: "absolute",
          left: mm(b.x === 0 ? -fondPerdu : b.x),
          top: mm(b.y === 0 ? -fondPerdu : b.y),
          width: mm(b.x === 0 ? b.largeur + 2 * fondPerdu : b.largeur),
          height: mm(b.y === 0 ? b.hauteur + fondPerdu : b.hauteur),
          backgroundColor: C["bleu-voile"],
          borderRadius: portrait ? 6 : 0,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: mm(b.x + (b.x === 0 ? 3 : 2)),
          top: mm(b.y),
          width: mm(b.largeur - (b.x === 0 ? 6 : 4)),
          height: mm(b.hauteur),
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
        }}
      >
        {eglise.logo ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf image: a PDF has no alt attribute
          <Image
            src={{ data: eglise.logo, format: "png" }}
            style={{
              height: mm(b.hauteur - 4),
              maxWidth: mm(b.largeur * 0.35),
              objectFit: "contain",
            }}
          />
        ) : null}
        <Text
          style={{
            fontFamily: "Fredoka",
            fontWeight: 600,
            fontSize: portrait ? 11 : 8.5,
            color: C.nuit,
            flexShrink: 1,
          }}
        >
          {eglise.nom}
        </Text>
      </View>

      <View
        style={{
          position: "absolute",
          left: mm(gabarit.texte.x),
          top: mm(gabarit.texte.y),
          width: mm(gabarit.texte.largeur),
          height: mm(gabarit.texte.hauteur),
          alignItems: portrait ? "center" : "flex-start",
        }}
      >
        <Text
          style={{
            fontFamily: "Nunito",
            fontWeight: 700,
            fontSize: portrait ? 10 : 7.5,
            color: C.nuit,
          }}
        >
          Famille {carte.famille}
        </Text>
        {affiches.map((e, i) => (
          <View
            key={i}
            style={{ flexDirection: "row", alignItems: "baseline", gap: 3, marginTop: 1 }}
          >
            <Text
              style={{
                fontFamily: "Fredoka",
                fontWeight: 600,
                fontSize: gabarit.corpsMatricule,
                color: C.nuit,
              }}
            >
              {e.matricule}
            </Text>
            <Text
              style={{ fontFamily: "Nunito", fontSize: portrait ? 9 : 7, color: C["texte-doux"] }}
            >
              {e.prenom}
            </Text>
          </View>
        ))}
        {reste > 0 ? (
          <Text
            style={{ fontFamily: "Nunito", fontSize: 6.5, color: C["texte-doux"], marginTop: 1 }}
          >
            + {reste} autre{reste > 1 ? "s" : ""}
          </Text>
        ) : null}
      </View>

      <Qr jeton={carte.jeton} gabarit={gabarit} />

      {gabarit.pied ? (
        <View
          style={{
            position: "absolute",
            left: mm(gabarit.pied.x),
            top: mm(gabarit.pied.y),
            width: mm(gabarit.pied.largeur),
            height: mm(gabarit.pied.hauteur),
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              fontFamily: "Nunito",
              fontSize: portrait ? TYPO.pied.portrait : TYPO.pied.paysage,
              lineHeight: TYPO.interligne,
              color: C.nuit,
              textAlign: portrait ? "center" : "left",
            }}
          >
            {piedDe(eglise)}
          </Text>
        </View>
      ) : null}

      {options.essai ? (
        <Text
          style={{
            position: "absolute",
            left: 0,
            top: mm(gabarit.hauteurMm / 2 - 6),
            width: mm(gabarit.largeurMm),
            textAlign: "center",
            fontFamily: "Fredoka",
            fontWeight: 600,
            fontSize: 26,
            color: C.bleu,
            opacity: 0.25,
          }}
        >
          ESSAI
        </Text>
      ) : null}
    </>
  );
}

function Verso({ eglise, gabarit }: { eglise: EgliseImpression; gabarit: Gabarit }) {
  const zone = zoneVerso(gabarit);
  const textes = textesDe(eglise);
  const telephone = ligneTelephone(textes, eglise.telephoneAccueil);
  const v = TYPO.verso;
  return (
    <View
      style={{
        position: "absolute",
        left: mm(zone.x),
        top: mm(zone.y),
        width: mm(zone.largeur),
      }}
    >
      <Text
        style={{
          fontFamily: "Fredoka",
          fontWeight: 600,
          fontSize: v.titre,
          lineHeight: TYPO.interligne,
          color: C.nuit,
          marginBottom: v.ecart,
        }}
      >
        {textes.titreVerso}
      </Text>
      {textes.consignesVerso.map((consigne, i) => (
        <Text
          key={i}
          style={{
            fontFamily: "Nunito",
            fontSize: v.consigne,
            lineHeight: TYPO.interligne,
            color: C.nuit,
            marginBottom: v.ecart,
          }}
        >
          {consigne}
        </Text>
      ))}
      {telephone ? (
        <Text
          style={{
            fontFamily: "Nunito",
            fontWeight: 700,
            fontSize: v.telephone,
            lineHeight: TYPO.interligne,
            color: C.nuit,
          }}
        >
          {telephone}
        </Text>
      ) : null}
      <Text
        style={{
          fontFamily: "Nunito",
          fontSize: v.nom,
          lineHeight: TYPO.interligne,
          color: C["texte-doux"],
          marginTop: v.ecart,
        }}
      >
        {eglise.nom}
      </Text>
    </View>
  );
}

/** One card (front or back) with its top-left trim corner at (x, y), in mm on the page. */
function Emplacement({
  x,
  y,
  gabarit,
  fondPerdu,
  children,
}: {
  x: number;
  y: number;
  gabarit: Gabarit;
  fondPerdu: number;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        position: "absolute",
        left: mm(x),
        top: mm(y),
        width: mm(gabarit.largeurMm),
        height: mm(gabarit.hauteurMm),
      }}
    >
      <View
        style={{
          position: "absolute",
          left: mm(-fondPerdu),
          top: mm(-fondPerdu),
          width: mm(gabarit.largeurMm + 2 * fondPerdu),
          height: mm(gabarit.hauteurMm + 2 * fondPerdu),
          backgroundColor: C.blanc,
        }}
      />
      {children}
    </View>
  );
}

/** Crop marks in the page margins, on every trim line of the grid. */
function TraitsDeCoupe({
  format,
  positions,
}: {
  format: FormatCarte;
  positions: { xMm: number; yMm: number }[];
}) {
  const xs = [...new Set(positions.flatMap((p) => [p.xMm, p.xMm + format.largeurMm]))];
  const ys = [...new Set(positions.flatMap((p) => [p.yMm, p.yMm + format.hauteurMm]))];
  const haut = Math.min(...positions.map((p) => p.yMm)) - FOND_PERDU_MM - TRAIT_COUPE.ecartMm;
  const bas =
    Math.max(...positions.map((p) => p.yMm + format.hauteurMm)) +
    FOND_PERDU_MM +
    TRAIT_COUPE.ecartMm;
  const gauche = Math.min(...positions.map((p) => p.xMm)) - FOND_PERDU_MM - TRAIT_COUPE.ecartMm;
  const droite =
    Math.max(...positions.map((p) => p.xMm + format.largeurMm)) +
    FOND_PERDU_MM +
    TRAIT_COUPE.ecartMm;
  const L = TRAIT_COUPE.longueurMm;
  const traits = [
    ...xs.flatMap((x) => [
      [x, haut - L, x, haut],
      [x, bas, x, bas + L],
    ]),
    ...ys.flatMap((y) => [
      [gauche - L, y, gauche, y],
      [droite, y, droite + L, y],
    ]),
  ];
  return (
    <Svg
      viewBox={`0 0 ${A4.largeurMm} ${A4.hauteurMm}`}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: mm(A4.largeurMm),
        height: mm(A4.hauteurMm),
      }}
    >
      {traits.map(([x1, y1, x2, y2], i) => (
        <Line key={i} x1={x1!} y1={y1!} x2={x2!} y2={y2!} stroke={C.nuit} strokeWidth={0.1} />
      ))}
    </Svg>
  );
}

function DocumentCartes({
  cartes,
  eglise,
  options,
}: {
  cartes: ContenuCarte[];
  eglise: EgliseImpression;
  options: OptionsImpression;
}) {
  const gabarit = calculerGabarit(options.format, !options.rectoVerso);
  const titre = options.essai ? "Carte d'essai" : `Cartes — ${eglise.nom}`;

  if (options.sortie === "unitaire") {
    // Exact size, not rounded: content of exactly the card's height must not overflow
    // the page by a fraction of a point, which would start a new page.
    const taille: [number, number] = [
      options.format.largeurMm * MM_EN_POINTS,
      options.format.hauteurMm * MM_EN_POINTS,
    ];
    return (
      <Document title={titre} author={eglise.nom} creator="Harvest Kids" producer="Harvest Kids">
        {cartes.flatMap((carte, i) => [
          <Page key={`r${i}`} size={taille} style={{ backgroundColor: C.blanc }}>
            <Emplacement x={0} y={0} gabarit={gabarit} fondPerdu={0}>
              <Recto
                carte={carte}
                eglise={eglise}
                gabarit={gabarit}
                options={options}
                fondPerdu={0}
              />
            </Emplacement>
          </Page>,
          ...(options.rectoVerso
            ? [
                <Page key={`v${i}`} size={taille} style={{ backgroundColor: C.blanc }}>
                  <Emplacement x={0} y={0} gabarit={gabarit} fondPerdu={0}>
                    <Verso eglise={eglise} gabarit={gabarit} />
                  </Emplacement>
                </Page>,
              ]
            : []),
        ])}
      </Document>
    );
  }

  const planche = disposerPlanche(options.format);
  const verso = positionsVerso(planche);
  const pages: ContenuCarte[][] = [];
  for (let i = 0; i < cartes.length; i += planche.parPage)
    pages.push(cartes.slice(i, i + planche.parPage));
  return (
    <Document title={titre} author={eglise.nom} creator="Harvest Kids" producer="Harvest Kids">
      {pages.flatMap((page, n) => [
        <Page key={`r${n}`} size="A4" style={{ backgroundColor: C.blanc }}>
          {page.map((carte, i) => (
            <Emplacement
              key={i}
              x={planche.positions[i]!.xMm}
              y={planche.positions[i]!.yMm}
              gabarit={gabarit}
              fondPerdu={FOND_PERDU_MM}
            >
              <Recto
                carte={carte}
                eglise={eglise}
                gabarit={gabarit}
                options={options}
                fondPerdu={FOND_PERDU_MM}
              />
            </Emplacement>
          ))}
          <TraitsDeCoupe
            format={options.format}
            positions={planche.positions.slice(0, page.length)}
          />
        </Page>,
        ...(options.rectoVerso
          ? [
              <Page key={`v${n}`} size="A4" style={{ backgroundColor: C.blanc }}>
                {page.map((_, i) => (
                  <Emplacement
                    key={i}
                    x={verso[i]!.xMm}
                    y={verso[i]!.yMm}
                    gabarit={gabarit}
                    fondPerdu={FOND_PERDU_MM}
                  >
                    <Verso eglise={eglise} gabarit={gabarit} />
                  </Emplacement>
                ))}
                <TraitsDeCoupe format={options.format} positions={verso.slice(0, page.length)} />
              </Page>,
            ]
          : []),
      ])}
    </Document>
  );
}

export function genererPdfCartes(
  cartes: ContenuCarte[],
  eglise: EgliseImpression,
  options: OptionsImpression,
): Promise<Buffer> {
  if (cartes.length === 0) throw new Error("Aucune carte à imprimer.");
  return renderToBuffer(<DocumentCartes cartes={cartes} eglise={eglise} options={options} />);
}

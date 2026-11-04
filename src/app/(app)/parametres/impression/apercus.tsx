import { MatriculeBadge } from "@/components/hk/matricule-badge";
import { dimensionsLisibles, type FormatCarte } from "@/server/impression/formats";
import { calculerGabarit, zoneVerso, type Gabarit } from "@/server/impression/planche";
import { matriceQr } from "@/server/impression/qr";
import { TYPO, ligneTelephone, textePied, type TextesCarte } from "@/server/impression/textes";

/** Same scale for every format: proportions are real (cahier §7.10). */
const PX_PAR_MM = 3;
const px = (mm: number) => `${mm * PX_PAR_MM}px`;
/** Type sizes of the PDF (points), at the preview's scale. */
const corps = (points: number) => `${((points * 25.4) / 72) * PX_PAR_MM}px`;
const JETON_EXEMPLE = "HKF1.Exemple000000000000000";

type EgliseApercu = {
  nom: string;
  logoKey: string | null;
  telephoneAccueil: string | null;
  textes: TextesCarte;
};

/**
 * The five formats side by side, drawn with the PDF's own layout (planche.ts), type sizes
 * and texts (textes.ts), the church's real logo and a fictitious family. The back is shown
 * when cards are printed on both sides. Pure rendering: nothing is written.
 */
export function ApercusCartes({
  formats,
  eglise,
  rectoSeul,
}: {
  formats: readonly FormatCarte[];
  eglise: EgliseApercu;
  rectoSeul: boolean;
}) {
  const qr = matriceQr(JETON_EXEMPLE);
  return (
    <ul
      className="m-0 flex list-none flex-wrap items-end gap-6 p-0"
      aria-label="Aperçus des formats"
    >
      {formats.map((format) => {
        const g = calculerGabarit(format, rectoSeul);
        return (
          <li key={format.id} className="grid gap-2">
            <div
              data-testid={`apercu-${format.id}`}
              data-largeur-mm={format.largeurMm}
              data-hauteur-mm={format.hauteurMm}
              role="img"
              aria-label={`Aperçu ${format.libelle}, ${dimensionsLisibles(format)}`}
              className="relative overflow-hidden rounded-sm bg-blanc shadow-card"
              style={{ width: px(format.largeurMm), height: px(format.hauteurMm) }}
            >
              <div
                className="absolute flex items-center gap-2 bg-bleu-voile px-2"
                style={{
                  left: px(g.bandeau.x),
                  top: px(g.bandeau.y),
                  width: px(g.bandeau.largeur),
                  height: px(g.bandeau.hauteur),
                  borderRadius: format.orientation === "portrait" ? 8 : 0,
                }}
              >
                {eglise.logoKey ? (
                  // eslint-disable-next-line @next/next/no-img-element -- authenticated route, not optimisable
                  <img
                    src={`/api/fichiers/${eglise.logoKey}`}
                    alt=""
                    className="h-3/4 w-auto max-w-[35%] object-contain"
                  />
                ) : null}
                <span className="truncate font-display text-[13px] font-semibold text-nuit">
                  {eglise.nom}
                </span>
              </div>
              <div
                className="absolute grid content-start gap-0.5"
                style={{ left: px(g.texte.x), top: px(g.texte.y), width: px(g.texte.largeur) }}
              >
                <span className="text-[11px] font-bold text-nuit">Famille Exemple</span>
                <span className="flex items-center gap-1 text-[10px] text-texte-doux">
                  <MatriculeBadge matricule="HK-0001" /> Ayo
                </span>
              </div>
              <svg
                viewBox={`0 0 ${qr.total} ${qr.total}`}
                className="absolute"
                style={{
                  left: px(g.qr.x),
                  top: px(g.qr.y),
                  width: px(g.qr.largeur),
                  height: px(g.qr.hauteur),
                }}
                aria-hidden
              >
                <rect width={qr.total} height={qr.total} fill="var(--color-blanc)" />
                {qr.segments.map((s, i) => (
                  <rect
                    key={i}
                    x={s.x}
                    y={s.y}
                    width={s.longueur}
                    height={1}
                    fill="var(--color-nuit)"
                  />
                ))}
              </svg>
              {g.pied ? (
                <span
                  data-testid={`pied-${format.id}`}
                  className="absolute flex items-center text-nuit"
                  style={{
                    left: px(g.pied.x),
                    top: px(g.pied.y),
                    width: px(g.pied.largeur),
                    height: px(g.pied.hauteur),
                    fontSize: corps(
                      format.orientation === "portrait" ? TYPO.pied.portrait : TYPO.pied.paysage,
                    ),
                    lineHeight: TYPO.interligne,
                    textAlign: format.orientation === "portrait" ? "center" : "left",
                  }}
                >
                  {textePied(eglise.textes, eglise.telephoneAccueil)}
                </span>
              ) : null}
            </div>
            {rectoSeul ? null : <ApercuVerso format={format} gabarit={g} eglise={eglise} />}
            <p className="m-0 max-w-64 text-label">
              <strong>{format.libelle}</strong>
              <br />
              {dimensionsLisibles(format)}, {format.orientation}
              <br />
              <span className="text-texte-doux">{format.usage}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function ApercuVerso({
  format,
  gabarit,
  eglise,
}: {
  format: FormatCarte;
  gabarit: Gabarit;
  eglise: EgliseApercu;
}) {
  const zone = zoneVerso(gabarit);
  const v = TYPO.verso;
  const telephone = ligneTelephone(eglise.textes, eglise.telephoneAccueil);
  const ecart = corps(v.ecart);
  return (
    <div
      data-testid={`verso-${format.id}`}
      role="img"
      aria-label={`Verso ${format.libelle}`}
      className="relative overflow-hidden rounded-sm bg-blanc shadow-card"
      style={{ width: px(format.largeurMm), height: px(format.hauteurMm) }}
    >
      <div
        className="absolute text-nuit"
        style={{
          left: px(zone.x),
          top: px(zone.y),
          width: px(zone.largeur),
          lineHeight: TYPO.interligne,
        }}
      >
        <p
          className="m-0 font-display font-semibold"
          style={{ fontSize: corps(v.titre), marginBottom: ecart }}
        >
          {eglise.textes.titreVerso}
        </p>
        {eglise.textes.consignesVerso.map((consigne, i) => (
          <p key={i} className="m-0" style={{ fontSize: corps(v.consigne), marginBottom: ecart }}>
            {consigne}
          </p>
        ))}
        {telephone ? (
          <p className="m-0 font-bold" style={{ fontSize: corps(v.telephone) }}>
            {telephone}
          </p>
        ) : null}
        <p className="m-0 text-texte-doux" style={{ fontSize: corps(v.nom), marginTop: ecart }}>
          {eglise.nom}
        </p>
      </div>
    </div>
  );
}

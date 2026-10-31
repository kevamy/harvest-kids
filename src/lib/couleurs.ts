/**
 * The few colours needed outside CSS (web manifest, theme-color meta, icon
 * generation, printed cards). Values must match design/tokens.css; a unit test checks it.
 */
export const COULEURS_HORS_CSS = {
  nuit: "#1f2557",
  creme: "#fbf0f2",
  blanc: "#ffffff",
  bleu: "#2369c4",
  "bleu-voile": "#dceefc",
  "texte-doux": "#5b6085",
  ligne: "#eadde2",
} as const;

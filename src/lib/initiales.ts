export function initiales(prenom: string, nom: string): string {
  const premiere = (mot: string) => mot.trim().charAt(0).toLocaleUpperCase("fr-FR");
  return `${premiere(prenom)}${premiere(nom)}`;
}

/**
 * Initials sit on bleu-layette or rose, alternating by position in the list,
 * never according to the child's sex (design/charte.md).
 */
export function teinteInitiales(index: number): "bleu" | "rose" {
  return index % 2 === 0 ? "bleu" : "rose";
}

/**
 * RG-01: "HK-" followed by 4 digits, 5 beyond 9999. Sequential per church,
 * never reused (the counter itself lives in the database).
 */
export function formatMatricule(numero: number): string {
  if (!Number.isInteger(numero) || numero < 1 || numero > 99_999) {
    throw new RangeError(`Numéro de matricule invalide : ${numero}`);
  }
  return `HK-${String(numero).padStart(4, "0")}`;
}

const MATRICULE = /^HK-(\d{4,5})$/;

export function estMatricule(valeur: string): boolean {
  const match = MATRICULE.exec(valeur);
  if (!match) return false;
  const chiffres = match[1]!;
  // 5 digits only above 9999: "HK-01234" is not a valid matricule.
  return chiffres.length === 4 || !chiffres.startsWith("0");
}

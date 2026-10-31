import { TZDate, tz } from "@date-fns/tz";
import { addDays, format, isValid, parse } from "date-fns";

/**
 * Calendar days in the church's time zone (RG-12): instants are stored in UTC, days are
 * read and typed in local time ("YYYY-MM-DD", as a date input gives them).
 */
const JOUR = "yyyy-MM-dd";

/** A "YYYY-MM-DD" day as a date, or null when it does not exist (30 February…). */
function lireJour(jour: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return null;
  const date = parse(jour, JOUR, new Date(0));
  return isValid(date) ? date : null;
}

export const estJourValide = (jour: string) => lireJour(jour) !== null;

/** Local day ("YYYY-MM-DD") of an instant in `fuseau`. */
export function jourLocal(instant: Date, fuseau: string): string {
  return format(instant, JOUR, { in: tz(fuseau) });
}

/** Day `n` days after `jour` ("YYYY-MM-DD"). */
export function ajouterJours(jour: string, n: number): string {
  const date = lireJour(jour);
  if (!date) throw new RangeError(`Jour invalide : ${jour}`);
  return format(addDays(date, n), JOUR);
}

/** Instant of local midnight at the start of `jour` ("YYYY-MM-DD") in `fuseau`. */
export function minuitLocal(jour: string, fuseau: string): Date {
  const date = lireJour(jour);
  if (!date) throw new RangeError(`Jour invalide : ${jour}`);
  const minuit = new TZDate(date.getFullYear(), date.getMonth(), date.getDate(), fuseau);
  return new Date(minuit.getTime());
}

/**
 * Calendar days in the church's time zone (RG-12): instants are stored in UTC, days are
 * read and typed in local time. Built on Intl (time zone data of the runtime).
 */

/** Offset of `fuseau` from UTC at `instant`, in milliseconds. */
function decalageMs(instant: Date, fuseau: string): number {
  const parties = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: fuseau,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(instant)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const local = Date.UTC(
    parties.year!,
    parties.month! - 1,
    parties.day!,
    parties.hour!,
    parties.minute!,
    parties.second!,
  );
  return local - Math.floor(instant.getTime() / 1000) * 1000;
}

const JOUR_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Checks a "YYYY-MM-DD" day (date input) and returns its parts, or null. */
function lireJour(jour: string): [number, number, number] | null {
  const m = JOUR_ISO.exec(jour);
  if (!m) return null;
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(a, mo - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j
    ? [a, mo, j]
    : null;
}

export const estJourValide = (jour: string) => lireJour(jour) !== null;

/** Local day ("YYYY-MM-DD") of an instant in `fuseau`. */
export function jourLocal(instant: Date, fuseau: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Day `n` days after `jour` ("YYYY-MM-DD"). */
export function ajouterJours(jour: string, n: number): string {
  const [a, m, j] = lireJour(jour) ?? [NaN, NaN, NaN];
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}

/** Instant of local midnight at the start of `jour` ("YYYY-MM-DD") in `fuseau`. */
export function minuitLocal(jour: string, fuseau: string): Date {
  const parties = lireJour(jour);
  if (!parties) throw new RangeError(`Jour invalide : ${jour}`);
  const naif = Date.UTC(parties[0], parties[1] - 1, parties[2]);
  // Second pass: the offset at the target instant may differ (daylight saving change).
  const approche = naif - decalageMs(new Date(naif), fuseau);
  return new Date(naif - decalageMs(new Date(approche), fuseau));
}

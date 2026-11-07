import { z } from "zod";

/** Days as stored in `Culte.jour`: 0 = Sunday … 6 = Saturday (as `Date.getDay`). */
export const JOURS = [
  "Dimanche",
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
] as const;

/** "08:00": local time of the church (RG-12), 24-hour clock. */
const heure = (message: string) =>
  z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, message);

/**
 * A recurring service (cahier §7.2, §17 point 4). Shared by the form and the server, which
 * checks it again. "HH:MM" strings compare in time order.
 */
export const schemaCulte = z
  .object({
    nom: z
      .string()
      .trim()
      .min(1, "Saisissez le nom du culte.")
      .max(60, "Le nom compte 60 caractères au plus."),
    jour: z
      .number({ message: "Choisissez le jour du culte." })
      .int()
      .min(0, "Choisissez le jour du culte.")
      .max(6, "Choisissez le jour du culte."),
    heureDebut: heure("Saisissez l'heure de début, par exemple 08:00."),
    heureFin: heure("Saisissez l'heure de fin, par exemple 10:00."),
    actif: z.boolean(),
  })
  .refine((c) => c.heureFin > c.heureDebut, {
    message: "L'heure de fin doit venir après l'heure de début.",
    path: ["heureFin"],
  });
export type SaisieCulte = z.infer<typeof schemaCulte>;

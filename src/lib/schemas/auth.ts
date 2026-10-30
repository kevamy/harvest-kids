import { z } from "zod";
import { formatPinValide } from "@/lib/pin";

/** Shared between the forms (React Hook Form) and the Server Actions. */
export const schemaConnexion = z.object({
  identifiant: z.string().trim().min(1, "Saisissez votre e-mail ou votre téléphone."),
  motDePasse: z.string().min(1, "Saisissez votre mot de passe."),
});

export const schemaPin = z.object({
  pin: z
    .string()
    .regex(/^\d{6}$/, "Le code PIN compte 6 chiffres.")
    .refine(formatPinValide, "Choisissez un code moins prévisible (pas 123456 ni 000000)."),
});

export const schemaDefinitionPin = schemaPin
  .extend({ confirmation: z.string() })
  .refine((v) => v.pin === v.confirmation, {
    message: "Les deux codes ne sont pas identiques.",
    path: ["confirmation"],
  });

export const schemaDeverrouillage = z.object({
  pin: z.string().regex(/^\d{6}$/, "Le code PIN compte 6 chiffres."),
});

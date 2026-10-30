import "server-only";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { PrismaClient, Role } from "@/generated/prisma/client";
import { formatPinValide } from "@/lib/pin";

/** A Prisma client or an interactive transaction (same table accessors). */
export type ClientComptes = Pick<PrismaClient, "user" | "authAccount" | "membre">;

/**
 * Accounts are created by a church administrator or the platform (never by public
 * sign-up). Passwords and PINs are hashed with Better Auth's scrypt hasher.
 */
export async function creerCompte(
  base: ClientComptes,
  donnees: {
    nom: string;
    email?: string | null;
    telephone?: string | null;
    motDePasse: string;
    superAdmin?: boolean;
  },
): Promise<string> {
  if (!donnees.email && !donnees.telephone) {
    throw new Error("Un compte doit avoir un e-mail ou un téléphone.");
  }
  if (donnees.motDePasse.length < 10) {
    throw new Error("Le mot de passe doit contenir au moins 10 caractères.");
  }
  // Better Auth requires an e-mail: phone-only accounts get a non-routable one.
  const email = donnees.email?.toLowerCase() ?? `tel-${randomUUID()}@telephone.invalid`;
  const motDePasse = await hashPassword(donnees.motDePasse);

  const user = await base.user.create({
    data: {
      name: donnees.nom,
      email,
      telephone: donnees.telephone ?? null,
      superAdmin: donnees.superAdmin ?? false,
    },
    select: { id: true },
  });
  // Better Auth identifies credential accounts by the user id.
  await base.authAccount.create({
    data: { userId: user.id, providerId: "credential", accountId: user.id, password: motDePasse },
  });
  return user.id;
}

export async function rattacherMembre(
  base: ClientComptes,
  donnees: { userId: string; egliseId: string; roles: Role[]; pin?: string },
): Promise<string> {
  const membre = await base.membre.create({
    data: {
      userId: donnees.userId,
      egliseId: donnees.egliseId,
      roles: donnees.roles,
      pinHash: donnees.pin ? await hacherPin(donnees.pin) : null,
    },
    select: { id: true },
  });
  return membre.id;
}

export async function hacherPin(pin: string): Promise<string> {
  if (!formatPinValide(pin)) throw new Error("Code PIN invalide.");
  return hashPassword(pin);
}

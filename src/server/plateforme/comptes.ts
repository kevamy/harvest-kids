import "server-only";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { PrismaClient, Role, TypeJetonCompte } from "@/generated/prisma/client";
import { empreinteJeton, genererJetonCompte } from "@/lib/jetons";
import { formatPinValide } from "@/lib/pin";

/** A Prisma client or an interactive transaction (same table accessors). */
export type ClientComptes = Pick<PrismaClient, "user" | "authAccount" | "membre">;

/** Expected refusal of an account operation, with the message to show (what to do). */
export class CompteRefuse extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompteRefuse";
  }
}

/** Placeholder e-mail of a phone-only account (Better Auth requires an e-mail). */
export const DOMAINE_SANS_EMAIL = "@telephone.invalid";

/**
 * Accounts are created by a church administrator or the platform (never by public
 * sign-up). Passwords and PINs are hashed with Better Auth's scrypt hasher. Without a
 * password, the account has no credential until it is activated by its one-time link
 * (ADR 0014): nobody can sign in with it before.
 */
export async function creerCompte(
  base: ClientComptes,
  donnees: {
    nom: string;
    email?: string | null;
    telephone?: string | null;
    motDePasse?: string;
    superAdmin?: boolean;
  },
): Promise<string> {
  if (!donnees.email && !donnees.telephone) {
    throw new Error("Un compte doit avoir un e-mail ou un téléphone.");
  }
  if (donnees.motDePasse !== undefined && donnees.motDePasse.length < 10) {
    throw new Error("Le mot de passe doit contenir au moins 10 caractères.");
  }
  const email = donnees.email?.toLowerCase() ?? `tel-${randomUUID()}${DOMAINE_SANS_EMAIL}`;

  const user = await base.user.create({
    data: {
      name: donnees.nom,
      email,
      telephone: donnees.telephone ?? null,
      superAdmin: donnees.superAdmin ?? false,
    },
    select: { id: true },
  });
  if (donnees.motDePasse !== undefined) await definirMotDePasse(base, user.id, donnees.motDePasse);
  return user.id;
}

/** Sets the password of the credential account (Better Auth identifies it by the user id). */
export async function definirMotDePasse(
  base: Pick<PrismaClient, "authAccount">,
  userId: string,
  motDePasse: string,
) {
  const hash = await hashPassword(motDePasse);
  const existant = await base.authAccount.findFirst({
    where: { userId, providerId: "credential" },
    select: { id: true },
  });
  if (existant) {
    await base.authAccount.update({ where: { id: existant.id }, data: { password: hash } });
  } else {
    await base.authAccount.create({
      data: { userId, providerId: "credential", accountId: userId, password: hash },
    });
  }
}

/** Validity of an account link: 7 days to activate an account, 24 hours to reset a password. */
export const DUREES_JETON: Record<TypeJetonCompte, string> = {
  ACTIVATION: "7 days",
  REINITIALISATION: "24 hours",
};

/**
 * Issues an account link (ADR 0014): the user's open links are revoked, the new one is
 * stored as a SHA-256 fingerprint, with its deadline set by PostgreSQL (now() + interval).
 * Returns the clear token, shown once and never stored.
 */
export async function emettreJetonCompte(
  tx: Pick<PrismaClient, "$executeRaw">,
  donnees: { userId: string; egliseId: string; type: TypeJetonCompte; creePar: string },
): Promise<string> {
  await tx.$executeRaw`
    UPDATE "JetonCompte" SET "revoqueLe" = now()
    WHERE "userId" = ${donnees.userId} AND "consommeLe" IS NULL AND "revoqueLe" IS NULL`;
  const jeton = genererJetonCompte();
  await tx.$executeRaw`
    INSERT INTO "JetonCompte" (id, "userId", "egliseId", type, "tokenHash", "expireLe", "creePar")
    VALUES (${randomUUID()}, ${donnees.userId}, ${donnees.egliseId},
            ${donnees.type}::"TypeJetonCompte", ${empreinteJeton(jeton)},
            now() + ${DUREES_JETON[donnees.type]}::interval, ${donnees.creePar})`;
  return jeton;
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

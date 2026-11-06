import "server-only";
import { getAuth } from "@/lib/auth";
import type { Identifiant } from "@/lib/identifiant";
import type { SessionCourante } from "@/lib/session";
import { prismaPlateforme } from "./db";
import { infosEglise } from "./eglises";
import { consommerDans, essaisConnexion, oublier } from "./limitation";
import { definirPin, deverrouillerAvecPin, reinitialiserEchecsPin, type ResultatPin } from "./pin";
import { choisirEgliseActive, eglisesDuCompte } from "./sessions";

/**
 * Services behind the sign-in, church choice and PIN screens. They work on
 * platform tables (accounts, sessions, memberships), outside any church.
 */

export type ResultatConnexion =
  | { statut: "connecte" }
  | { statut: "refuse" }
  | { statut: "trop_de_tentatives"; reessayerDansMs: number };

export async function connecterAvecIdentifiant(
  identifiant: Identifiant,
  motDePasse: string,
  requete: { entetes: Headers; ip: string },
): Promise<ResultatConnexion> {
  const base = prismaPlateforme();
  const maintenant = new Date();
  const essais = essaisConnexion(identifiant.valeur, requete.ip);
  const { autorise, reessayerDansMs } = await consommerDans(base, essais, maintenant);
  if (!autorise) return { statut: "trop_de_tentatives", reessayerDansMs };
  const [[cleIdentifiant]] = essais;

  // A phone number is mapped to the account's e-mail. An unknown number goes through
  // the same failing sign-in, so the answer never reveals whether an account exists.
  const email =
    identifiant.type === "email"
      ? identifiant.valeur
      : ((
          await base.user.findUnique({
            where: { telephone: identifiant.valeur },
            select: { email: true },
          })
        )?.email ?? "inconnu@telephone.invalid");

  try {
    const { user } = await getAuth().api.signInEmail({
      body: { email, password: motDePasse },
      headers: requete.entetes,
    });
    await oublier(base, cleIdentifiant);
    await reinitialiserEchecsPin(base, user.id);
    return { statut: "connecte" };
  } catch {
    return { statut: "refuse" };
  }
}

export async function eglisesAccessibles(userId: string) {
  return eglisesDuCompte(prismaPlateforme(), userId);
}

export async function choisirEgliseDeLaSession(session: SessionCourante, egliseId: string) {
  return choisirEgliseActive(
    prismaPlateforme(),
    { sessionId: session.sessionId, userId: session.userId },
    egliseId,
  );
}

export async function definirPinDuMembre(membreId: string, pin: string) {
  await definirPin(prismaPlateforme(), membreId, pin);
}

export async function pinEstDefini(membreId: string): Promise<boolean> {
  const membre = await prismaPlateforme().membre.findUnique({
    where: { id: membreId },
    select: { pinHash: true },
  });
  return Boolean(membre?.pinHash);
}

export async function deverrouillerSession(
  session: SessionCourante,
  pin: string,
): Promise<ResultatPin> {
  if (!session.egliseActiveId) return { statut: "non_defini" };
  return deverrouillerAvecPin(
    prismaPlateforme(),
    { sessionId: session.sessionId, userId: session.userId, egliseId: session.egliseActiveId },
    pin,
    new Date(),
  );
}

export async function egliseActiveAffichee(egliseId: string) {
  return infosEglise(prismaPlateforme(), egliseId);
}

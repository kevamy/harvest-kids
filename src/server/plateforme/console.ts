import "server-only";
import { getSessionCourante, type SessionCourante } from "@/lib/session";
import { prismaPlateforme } from "./db";
import {
  changerStatutEglise,
  creerEgliseAvecPremierAdmin,
  listerEglises,
  type NouvelleEglise,
  type ResultatCreation,
} from "./eglises";

/**
 * Platform console (/plateforme), reserved to SUPER_ADMIN. Every operation checks
 * the role on the server; the console never reads a church's personal data.
 */
export class AccesPlateformeRefuse extends Error {
  constructor() {
    super("Accès réservé au super-administrateur");
    this.name = "AccesPlateformeRefuse";
  }
}

export async function exigerSuperAdmin(): Promise<SessionCourante> {
  const session = await getSessionCourante();
  if (!session?.superAdmin || session.verrouillee) throw new AccesPlateformeRefuse();
  return session;
}

export async function eglisesDeLaPlateforme() {
  await exigerSuperAdmin();
  return listerEglises(prismaPlateforme());
}

export async function creerEglise(donnees: NouvelleEglise): Promise<ResultatCreation> {
  const session = await exigerSuperAdmin();
  return creerEgliseAvecPremierAdmin(prismaPlateforme(), donnees, session.userId);
}

export async function suspendreOuReactiver(egliseId: string, statut: "ACTIVE" | "SUSPENDUE") {
  const session = await exigerSuperAdmin();
  return changerStatutEglise(prismaPlateforme(), egliseId, statut, session.userId);
}

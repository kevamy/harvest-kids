/**
 * Authentication, active church, activity, PIN and sign-in throttling, against
 * the real test database (Better Auth + Prisma, hk_app role).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { INTERVALLE_ENREGISTREMENT_MS } from "@/lib/activite";
import { creerAuth, type Auth } from "@/lib/auth";
import { MAX_ECHECS_PIN } from "@/lib/pin";
import { creerCompte, rattacherMembre } from "@/server/plateforme/comptes";
import { creerClientPlateforme } from "@/server/plateforme/db";
import { consommer, REGLES_CONNEXION } from "@/server/plateforme/limitation";
import { definirPin, deverrouillerAvecPin } from "@/server/plateforme/pin";
import {
  choisirEgliseActive,
  eglisesDuCompte,
  enregistrerActivite,
} from "@/server/plateforme/sessions";
import { type Client, type Jeu, connecter, creerEglise, viderBase } from "./support/db";
import { urlsDeTest } from "./support/urls";

const MOT_DE_PASSE = "Mot-de-passe-test-2026";

let base: PrismaClient;
let proprietaire: Client;
let auth: Auth;
let a: Jeu;
let b: Jeu;
let comptes: { accueilA: string; double: string; inactif: string };

async function connexion(email: string, motDePasse = MOT_DE_PASSE) {
  return auth.api.signInEmail({ body: { email, password: motDePasse }, returnHeaders: true });
}

async function sessionDe(userId: string) {
  return base.authSession.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });
}

beforeAll(async () => {
  base = creerClientPlateforme(urlsDeTest().app);
  proprietaire = await connecter("proprietaire");
  auth = creerAuth({
    prisma: base,
    secret: "secret-de-test-".padEnd(40, "x"),
    baseURL: "http://localhost:3000",
    cookiesNext: false,
  });
});

afterAll(async () => {
  await base?.$disconnect();
  await proprietaire?.end();
});

beforeEach(async () => {
  await viderBase(proprietaire);
  a = await creerEglise(proprietaire, "a");
  b = await creerEglise(proprietaire, "b");

  const accueilA = await creerCompte(base, {
    nom: "Accueil A",
    email: "accueil.a@harvest-kids.test",
    telephone: "+2290197000001",
    motDePasse: MOT_DE_PASSE,
  });
  await rattacherMembre(base, {
    userId: accueilA,
    egliseId: a.egliseId,
    roles: ["ACCUEIL"],
    pin: "482913",
  });

  const double = await creerCompte(base, {
    nom: "Moniteur A et B",
    email: "double@harvest-kids.test",
    motDePasse: MOT_DE_PASSE,
  });
  await rattacherMembre(base, { userId: double, egliseId: a.egliseId, roles: ["MONITEUR"] });
  await rattacherMembre(base, { userId: double, egliseId: b.egliseId, roles: ["MONITEUR"] });

  const inactif = await creerCompte(base, {
    nom: "Inactif",
    email: "inactif@harvest-kids.test",
    motDePasse: MOT_DE_PASSE,
  });
  await rattacherMembre(base, { userId: inactif, egliseId: a.egliseId, roles: ["ACCUEIL"] });
  await base.user.update({ where: { id: inactif }, data: { actif: false } });

  comptes = { accueilA, double, inactif };
});

describe("connexion", () => {
  it("ouvre une session et entre directement dans l'unique église du compte", async () => {
    const { response } = await connexion("accueil.a@harvest-kids.test");
    expect(response.user.id).toBe(comptes.accueilA);
    const session = await sessionDe(comptes.accueilA);
    expect(session.egliseActiveId).toBe(a.egliseId);
    expect(session.derniereActivite).toBeInstanceOf(Date);
  });

  it("un compte membre de deux églises doit choisir son église", async () => {
    await connexion("double@harvest-kids.test");
    expect((await sessionDe(comptes.double)).egliseActiveId).toBeNull();
  });

  it("refuse un mauvais mot de passe et un compte désactivé", async () => {
    await expect(
      connexion("accueil.a@harvest-kids.test", "mauvais-mot-de-passe"),
    ).rejects.toThrow();
    await expect(connexion("inactif@harvest-kids.test")).rejects.toThrow();
    expect(await base.authSession.count({ where: { userId: comptes.inactif } })).toBe(0);
  });

  it("l'inscription publique est fermée", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { name: "Intrus", email: "intrus@harvest-kids.test", password: MOT_DE_PASSE },
      }),
    ).rejects.toThrow();
  });

  it("la session renvoyée porte l'église active et la dernière activité", async () => {
    const { headers } = await connexion("accueil.a@harvest-kids.test");
    const cookie = headers.get("set-cookie") ?? "";
    const resultat = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(resultat?.session).toMatchObject({ egliseActiveId: a.egliseId });
    expect((resultat?.session as { derniereActivite?: unknown }).derniereActivite).toBeTruthy();
  });
});

describe("église active", () => {
  it("ne propose que les églises actives dont le compte est membre actif", async () => {
    expect((await eglisesDuCompte(base, comptes.double)).map((e) => e.id).sort()).toEqual(
      [a.egliseId, b.egliseId].sort(),
    );
    await base.eglise.update({ where: { id: b.egliseId }, data: { statut: "SUSPENDUE" } });
    expect((await eglisesDuCompte(base, comptes.double)).map((e) => e.id)).toEqual([a.egliseId]);
  });

  it("refuse de choisir une église dont on n'est pas membre", async () => {
    await connexion("accueil.a@harvest-kids.test");
    const session = await sessionDe(comptes.accueilA);
    const cible = { sessionId: session.id, userId: comptes.accueilA };
    expect(await choisirEgliseActive(base, cible, b.egliseId)).toBe(false);
    expect((await sessionDe(comptes.accueilA)).egliseActiveId).toBe(a.egliseId);
  });

  it("permet de passer d'une église à l'autre pour un membre des deux", async () => {
    await connexion("double@harvest-kids.test");
    const session = await sessionDe(comptes.double);
    const cible = { sessionId: session.id, userId: comptes.double };
    expect(await choisirEgliseActive(base, cible, b.egliseId)).toBe(true);
    expect((await sessionDe(comptes.double)).egliseActiveId).toBe(b.egliseId);
  });

  it("refuse de modifier la session d'un autre compte", async () => {
    await connexion("double@harvest-kids.test");
    const session = await sessionDe(comptes.double);
    expect(
      await choisirEgliseActive(
        base,
        { sessionId: session.id, userId: comptes.accueilA },
        a.egliseId,
      ),
    ).toBe(false);
  });
});

describe("dernière activité", () => {
  it("n'est enregistrée qu'une fois par minute au plus", async () => {
    await connexion("accueil.a@harvest-kids.test");
    const { id } = await sessionDe(comptes.accueilA);
    const t0 = new Date(Date.now() + 5 * 60_000);
    expect(await enregistrerActivite(base, id, t0)).toBe(true);
    expect(await enregistrerActivite(base, id, new Date(t0.getTime() + 30_000))).toBe(false);
    expect(
      await enregistrerActivite(base, id, new Date(t0.getTime() + INTERVALLE_ENREGISTREMENT_MS)),
    ).toBe(true);
  });
});

describe("code PIN", () => {
  async function cible() {
    await connexion("accueil.a@harvest-kids.test");
    const session = await sessionDe(comptes.accueilA);
    return { sessionId: session.id, userId: comptes.accueilA, egliseId: a.egliseId };
  }

  it("déverrouille avec le bon code et enregistre l'activité", async () => {
    const c = await cible();
    const maintenant = new Date(Date.now() + 20 * 60_000);
    expect(await deverrouillerAvecPin(base, c, "482913", maintenant)).toEqual({
      statut: "deverrouille",
    });
    expect((await sessionDe(comptes.accueilA)).derniereActivite).toEqual(maintenant);
  });

  it(`bloque après ${MAX_ECHECS_PIN} erreurs, même avec le bon code ensuite`, async () => {
    const c = await cible();
    const maintenant = new Date();
    for (let i = 1; i < MAX_ECHECS_PIN; i++) {
      expect(await deverrouillerAvecPin(base, c, "111222", maintenant)).toEqual({
        statut: "incorrect",
        essaisRestants: MAX_ECHECS_PIN - i,
      });
    }
    expect(await deverrouillerAvecPin(base, c, "111222", maintenant)).toEqual({ statut: "bloque" });
    expect(await deverrouillerAvecPin(base, c, "482913", maintenant)).toEqual({ statut: "bloque" });
  });

  it("le PIN d'une église ne sert pas dans une autre", async () => {
    await connexion("double@harvest-kids.test");
    const session = await sessionDe(comptes.double);
    const membreA = await base.membre.findUniqueOrThrow({
      where: { egliseId_userId: { egliseId: a.egliseId, userId: comptes.double } },
    });
    await definirPin(base, membreA.id, "205871");
    const dansB = { sessionId: session.id, userId: comptes.double, egliseId: b.egliseId };
    expect(await deverrouillerAvecPin(base, dansB, "205871", new Date())).toEqual({
      statut: "non_defini",
    });
  });
});

describe("limitation des tentatives de connexion", () => {
  it("autorise 5 tentatives par identifiant puis bloque jusqu'à la fin de la fenêtre", async () => {
    const regle = REGLES_CONNEXION.identifiant;
    const t0 = new Date();
    for (let i = 0; i < regle.max; i++) {
      expect((await consommer(base, "connexion:x@y.z", regle, t0)).autorise).toBe(true);
    }
    const refus = await consommer(base, "connexion:x@y.z", regle, t0);
    expect(refus.autorise).toBe(false);
    expect(refus.reessayerDansMs).toBeGreaterThan(0);

    expect((await consommer(base, "connexion:autre@y.z", regle, t0)).autorise).toBe(true);
    const apres = new Date(t0.getTime() + regle.fenetreMs + 1);
    expect((await consommer(base, "connexion:x@y.z", regle, apres)).autorise).toBe(true);
  });

  it("résiste aux tentatives simultanées", async () => {
    const regle = REGLES_CONNEXION.identifiant;
    const t0 = new Date();
    const resultats = await Promise.all(
      Array.from({ length: 20 }, () => consommer(base, "connexion:rafale", regle, t0)),
    );
    expect(resultats.filter((r) => r.autorise)).toHaveLength(regle.max);
  });
});

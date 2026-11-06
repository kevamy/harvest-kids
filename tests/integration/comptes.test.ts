/**
 * Accounts of a church (cahier §7.10, ADR 0014) on PostgreSQL: creation with a one-time
 * activation link (SHA-256 only, 7 days), direct attachment of an existing account, reset
 * effective at once (24 hours), links refused when expired, replaced, used or of a
 * deactivated member, accounts of several churches left to the super-administrator, the
 * administrator guards (under lock, concurrent case included) and isolation A/B.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { creerAuth, type Auth } from "@/lib/auth";
import { empreinteJeton } from "@/lib/jetons";
import { DERNIER_ADMIN, modifierMembre } from "@/server/plateforme/badges";
import { CompteRefuse, creerCompte, rattacherMembre } from "@/server/plateforme/comptes";
import {
  LIEN_INVALIDE,
  RESERVE_SUPER_ADMIN,
  activerCompte,
  ajouterCompte,
  genererLienActivation,
  listerComptes,
  reinitialiserMotDePasse,
} from "@/server/plateforme/comptes-eglise";
import { creerClientPlateforme } from "@/server/plateforme/db";
import { type Client, type Jeu, connecter, creerEglise, enEglise, viderBase } from "./support/db";
import { urlsDeTest } from "./support/urls";

const MOT_DE_PASSE = "Mot-de-passe-2026";
const NOUVEAU = "Nouveau-secret-2026";

let base: PrismaClient;
let proprietaire: Client;
let auth: Auth;
let a: Jeu;
let b: Jeu;
let adminA: { userId: string; membreId: string };
let auteurA: { egliseId: string; userId: string; appareil: null };

const peutSeConnecter = async (email: string, motDePasse: string) => {
  try {
    await auth.api.signInEmail({ body: { email, password: motDePasse } });
    return true;
  } catch {
    return false;
  }
};

async function membre(
  egliseId: string,
  email: string,
  roles: ("ADMIN" | "MONITEUR")[],
  motDePasse?: string,
) {
  const userId = await creerCompte(base, { nom: email.split("@")[0]!, email, motDePasse });
  const membreId = await rattacherMembre(base, { userId, egliseId, roles });
  return { userId, membreId };
}

const ajouter = (identifiant: string, roles: string[] = ["MONITEUR"]) =>
  ajouterCompte(base, auteurA, { nom: "Koffi Moniteur", identifiant, roles }, "229");

const activer = (jeton: string, motDePasse = NOUVEAU) =>
  activerCompte(base, { jeton, motDePasse, confirmation: motDePasse });

const etat = async (membreId: string) =>
  (await listerComptes(base, auteurA)).find((c) => c.membreId === membreId)?.etat;

const duree = async (jeton: string) => {
  const { rows } = await proprietaire.query<{ duree: string }>(
    `SELECT ("expireLe" - "createdAt")::text AS duree FROM "JetonCompte" WHERE "tokenHash" = $1`,
    [empreinteJeton(jeton)],
  );
  return rows[0]?.duree;
};

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
  adminA = await membre(a.egliseId, "admin.a@harvest-kids.test", ["ADMIN"], MOT_DE_PASSE);
  auteurA = { egliseId: a.egliseId, userId: adminA.userId, appareil: null };
});

describe("création et activation", () => {
  it("crée un compte sans mot de passe, avec un lien de 7 jours à usage unique, puis l'active", async () => {
    const resultat = await ajouter("Koffi.Moniteur@harvest-kids.test");
    if (resultat.statut !== "cree") throw new Error("création attendue");
    expect(resultat.jeton).toMatch(/^HKC1\.[0-9A-Za-z]{43}$/);
    expect(await duree(resultat.jeton)).toMatch(/^7 days/);
    expect(await etat(resultat.membreId)).toBe("en_attente");
    expect(await peutSeConnecter("koffi.moniteur@harvest-kids.test", "")).toBe(false);

    // Only the fingerprint is stored; neither the token nor personal data reach the audit.
    const { rows: jetons } = await proprietaire.query(`SELECT * FROM "JetonCompte"`);
    expect(JSON.stringify(jetons)).not.toContain(resultat.jeton);
    expect(jetons[0]).toMatchObject({ tokenHash: empreinteJeton(resultat.jeton) });

    expect(await activer(resultat.jeton)).toEqual({ type: "ACTIVATION" });
    expect(await peutSeConnecter("koffi.moniteur@harvest-kids.test", NOUVEAU)).toBe(true);
    expect(await etat(resultat.membreId)).toBe("actif");
    // Used once only.
    await expect(activer(resultat.jeton, "Encore-un-autre-2026")).rejects.toThrow(LIEN_INVALIDE);

    const { rows: audit } = await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(`SELECT action, "entiteId", apres FROM "AuditLog" ORDER BY "createdAt"`),
    );
    expect(audit.map((e) => e.action)).toEqual(["compte.cree", "compte.active"]);
    expect(JSON.stringify(audit)).not.toMatch(/koffi|harvest-kids\.test|HKC1/i);
  });

  it("refuse deux mots de passe différents ou trop courts, sans consommer le lien", async () => {
    const resultat = await ajouter("ayo@harvest-kids.test");
    if (resultat.statut !== "cree") throw new Error("création attendue");
    await expect(
      activerCompte(base, { jeton: resultat.jeton, motDePasse: NOUVEAU, confirmation: "autre" }),
    ).rejects.toThrow("Les deux mots de passe ne sont pas identiques.");
    await expect(activer(resultat.jeton, "court")).rejects.toThrow("au moins 10 caractères");
    expect(await activer(resultat.jeton)).toEqual({ type: "ACTIVATION" });
  });

  it("accepte un téléphone au format E.164 et refuse un numéro à 8 chiffres non confirmé", async () => {
    await expect(ajouter("97 45 12 33")).rejects.toThrow("Voulez-vous dire 01 97 45 12 33 ?");
    const resultat = await ajouter("01 97 45 12 33");
    const compte = (await listerComptes(base, auteurA)).find(
      (c) => c.membreId === resultat.membreId,
    );
    expect(compte).toMatchObject({ email: null, telephone: "+2290197451233" });
  });

  it("rattache un compte existant d'une autre église, avec une réponse neutre et sans lien", async () => {
    const autre = await membre(b.egliseId, "double@harvest-kids.test", ["MONITEUR"], MOT_DE_PASSE);
    const resultat = await ajouter("DOUBLE@harvest-kids.test", ["ACCUEIL"]);
    expect(Object.keys(resultat).sort()).toEqual(["membreId", "statut"]);
    expect(resultat.statut).toBe("rattache");
    expect(await base.membre.count({ where: { userId: autre.userId } })).toBe(2);
    expect(await base.jetonCompte.count()).toBe(0);
    await expect(ajouter("double@harvest-kids.test")).rejects.toThrow(
      "Ce compte fait déjà partie de votre église.",
    );
  });
});

describe("liens refusés", () => {
  it("un lien expiré, remplacé ou d'un membre désactivé depuis est refusé", async () => {
    const resultat = await ajouter("expire@harvest-kids.test");
    if (resultat.statut !== "cree") throw new Error("création attendue");
    // The deadline is moved back from its own value (PostgreSQL clock).
    await proprietaire.query(
      `UPDATE "JetonCompte" SET "expireLe" = "expireLe" - interval '8 days'`,
    );
    await expect(activer(resultat.jeton)).rejects.toThrow(LIEN_INVALIDE);
    expect(await etat(resultat.membreId)).toBe("lien_expire");

    const second = (await genererLienActivation(base, auteurA, resultat.membreId))!;
    const troisieme = (await genererLienActivation(base, auteurA, resultat.membreId))!;
    await expect(activer(second.jeton)).rejects.toThrow(LIEN_INVALIDE); // replaced
    await modifierMembre(base, auteurA, resultat.membreId, { actif: false });
    await expect(activer(troisieme.jeton)).rejects.toThrow(LIEN_INVALIDE); // deactivated
    expect(await etat(resultat.membreId)).toBe("desactive");
    await expect(activer("HKC1.inconnu")).rejects.toThrow(LIEN_INVALIDE);
  });

  it("un compte déjà activé n'a pas de nouveau lien d'activation", async () => {
    const moniteur = await membre(
      a.egliseId,
      "actif@harvest-kids.test",
      ["MONITEUR"],
      MOT_DE_PASSE,
    );
    await expect(genererLienActivation(base, auteurA, moniteur.membreId)).rejects.toThrow(
      "Ce compte est déjà activé.",
    );
  });
});

describe("réinitialisation du mot de passe", () => {
  it("efface le mot de passe et ferme les sessions tout de suite, avec un lien de 24 heures", async () => {
    const moniteur = await membre(
      a.egliseId,
      "reinit@harvest-kids.test",
      ["MONITEUR"],
      MOT_DE_PASSE,
    );
    expect(await peutSeConnecter("reinit@harvest-kids.test", MOT_DE_PASSE)).toBe(true);
    expect(await base.authSession.count({ where: { userId: moniteur.userId } })).toBe(1);

    const { jeton } = (await reinitialiserMotDePasse(base, auteurA, moniteur.membreId))!;
    expect(await duree(jeton)).toMatch(/^24:00:00|^1 day/);
    expect(await base.authSession.count({ where: { userId: moniteur.userId } })).toBe(0);
    expect(await peutSeConnecter("reinit@harvest-kids.test", MOT_DE_PASSE)).toBe(false);
    expect(await etat(moniteur.membreId)).toBe("reinitialisation");

    expect(await activer(jeton)).toEqual({ type: "REINITIALISATION" });
    expect(await peutSeConnecter("reinit@harvest-kids.test", NOUVEAU)).toBe(true);
    const { rows } = await enEglise(proprietaire, a.egliseId, () =>
      proprietaire.query(
        `SELECT action, apres FROM "AuditLog" WHERE action LIKE 'compte.%' ORDER BY "createdAt"`,
      ),
    );
    expect(rows).toEqual([
      { action: "compte.reinitialise", apres: { sessionsFermees: 1 } },
      { action: "compte.mot_de_passe_reinitialise", apres: null },
    ]);
  });

  it("est réservée au super-administrateur pour un compte d'une autre église aussi, ou super-administrateur", async () => {
    const double = await membre(a.egliseId, "double@harvest-kids.test", ["MONITEUR"], MOT_DE_PASSE);
    await rattacherMembre(base, { userId: double.userId, egliseId: b.egliseId, roles: ["ADMIN"] });
    await expect(reinitialiserMotDePasse(base, auteurA, double.membreId)).rejects.toThrow(
      RESERVE_SUPER_ADMIN,
    );
    const enAttente = await membre(a.egliseId, "attente@harvest-kids.test", ["MONITEUR"]);
    await rattacherMembre(base, {
      userId: enAttente.userId,
      egliseId: b.egliseId,
      roles: ["ACCUEIL"],
    });
    await expect(genererLienActivation(base, auteurA, enAttente.membreId)).rejects.toThrow(
      RESERVE_SUPER_ADMIN,
    );
    const superAdmin = await creerCompte(base, {
      nom: "Super",
      email: "super@harvest-kids.test",
      motDePasse: MOT_DE_PASSE,
      superAdmin: true,
    });
    const superMembre = await rattacherMembre(base, {
      userId: superAdmin,
      egliseId: a.egliseId,
      roles: ["ADMIN"],
    });
    await expect(reinitialiserMotDePasse(base, auteurA, superMembre)).rejects.toThrow(CompteRefuse);
    expect(await peutSeConnecter("double@harvest-kids.test", MOT_DE_PASSE)).toBe(true);
  });
});

describe("garde-fous des administrateurs", () => {
  it("un administrateur ne désactive pas son propre compte", async () => {
    await expect(modifierMembre(base, auteurA, adminA.membreId, { actif: false })).rejects.toThrow(
      "Vous ne pouvez pas désactiver votre propre compte.",
    );
  });

  it("l'église garde au moins un administrateur actif", async () => {
    await expect(
      modifierMembre(base, auteurA, adminA.membreId, { roles: ["RESPONSABLE"] }),
    ).rejects.toThrow(DERNIER_ADMIN);
    const second = await membre(a.egliseId, "admin2.a@harvest-kids.test", ["ADMIN"], MOT_DE_PASSE);
    await modifierMembre(base, auteurA, adminA.membreId, { roles: ["RESPONSABLE"] });
    const auteur2 = { egliseId: a.egliseId, userId: second.userId, appareil: null };
    await expect(
      modifierMembre(base, auteur2, second.membreId, { roles: ["MONITEUR"] }),
    ).rejects.toThrow(DERNIER_ADMIN);
  });

  it("deux administrateurs qui se retirent mutuellement : le second attend le premier et est refusé", async () => {
    const second = await membre(a.egliseId, "admin2.a@harvest-kids.test", ["ADMIN"], MOT_DE_PASSE);
    const auteur2 = { egliseId: a.egliseId, userId: second.userId, appareil: null };

    // The first change is held inside its transaction, right after its check.
    let signalerPause!: () => void;
    const enPause = new Promise<void>((r) => (signalerPause = r));
    let reprendre!: () => void;
    const reprise = new Promise<void>((r) => (reprendre = r));
    const premier = Promise.allSettled([
      modifierMembre(
        base,
        auteurA,
        second.membreId,
        { roles: ["MONITEUR"] },
        {
          apresVerification: async () => {
            signalerPause();
            await reprise;
          },
        },
      ),
    ]);
    await enPause;

    // The second starts on another connection while the first is held: the overlap is
    // certain. It either waits for the first one's lock, or (without the lock) ends alone.
    let secondTermine = false;
    const secondChangement = Promise.allSettled([
      modifierMembre(base, auteur2, adminA.membreId, { actif: false }).finally(() => {
        secondTermine = true;
      }),
    ]);
    const verrousEnAttente = async () =>
      (
        await proprietaire.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted`,
        )
      ).rows[0]!.n;
    await expect
      .poll(async () => secondTermine || (await verrousEnAttente()) > 0, { timeout: 5_000 })
      .toBe(true);
    reprendre();

    const [[r1], [r2]] = await Promise.all([premier, secondChangement]);
    expect(r1!.status).toBe("fulfilled");
    expect(r2!.status).toBe("rejected");
    const refus = (r2 as PromiseRejectedResult).reason as Error;
    expect(refus).toBeInstanceOf(CompteRefuse);
    expect(refus.message).toBe(DERNIER_ADMIN);
    const { rows } = await proprietaire.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "Membre"
       WHERE "egliseId" = $1 AND actif AND 'ADMIN' = ANY (roles)`,
      [a.egliseId],
    );
    expect(rows[0]!.n).toBe(1);
  });
});

describe("isolation A/B", () => {
  it("un administrateur de A ne voit ni ne modifie un membre de B", async () => {
    const moniteurB = await membre(b.egliseId, "moniteur.b@harvest-kids.test", ["MONITEUR"]);
    expect((await listerComptes(base, auteurA)).map((c) => c.membreId)).toEqual([adminA.membreId]);
    expect(await genererLienActivation(base, auteurA, moniteurB.membreId)).toBeNull();
    expect(await reinitialiserMotDePasse(base, auteurA, moniteurB.membreId)).toBeNull();
    expect(await modifierMembre(base, auteurA, moniteurB.membreId, { actif: false })).toBeNull();
    expect(await base.jetonCompte.count()).toBe(0);
    expect((await base.membre.findUniqueOrThrow({ where: { id: moniteurB.membreId } })).actif).toBe(
      true,
    );
  });
});

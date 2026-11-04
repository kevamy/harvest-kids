/**
 * Monitor badges (cahier §7.10, RG-02, RG-03, RG-14, ADR 0008): one active badge per
 * member, replaced at once by a reprint; a member deactivated or who loses the MONITEUR
 * role has their badge revoked in the same transaction, and its scan is refused.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { clientEglise, type ClientEglise } from "@/lib/tenant";
import { MESSAGES_SCAN, resoudreJeton } from "@/server/cartes/resolution";
import type { ContenuBadge } from "@/server/impression/pdf-carte";

// The real renderer, recording the printed tokens; a test may ask for a rendering failure.
const rendu = vi.hoisted(() => ({ echoue: false, badges: [] as ContenuBadge[] }));
vi.mock("@/server/impression/pdf-carte", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/server/impression/pdf-carte")>();
  return {
    ...reel,
    genererPdfCartes: (...args: Parameters<typeof reel.genererPdfCartes>) => {
      if (rendu.echoue) return Promise.reject(new Error("rendu impossible"));
      rendu.badges = args[0] as ContenuBadge[];
      return reel.genererPdfCartes(...args);
    },
  };
});
import {
  BadgeImpossible,
  ImpressionBadgesRefusee,
  emettreBadges,
  imprimerBadges,
  listerMoniteurs,
  modifierMembre,
  verificationMoniteur,
} from "@/server/plateforme/badges";
import { creerClientPlateforme } from "@/server/plateforme/db";
import {
  type Client,
  type Jeu,
  codeErreur,
  connecter,
  contexteVerifie,
  creerEglise,
  enEglise,
  viderBase,
} from "./support/db";
import { urlsDeTest } from "./support/urls";

let base: PrismaClient;
let proprietaire: Client;
let a: Jeu;
let b: Jeu;
let dbA: ClientEglise;

const EGLISE = { nom: "Église A", logo: null, telephoneAccueil: null };

/** A member of a church with the given roles (platform tables, owner role). */
async function membre(jeu: Jeu, cle: string, roles: string[]) {
  const id = `membre_${cle}`;
  await proprietaire.query(
    `INSERT INTO "User" (id, name, email, "updatedAt") VALUES ($1, $2, $3, now())`,
    [`user_${cle}`, `Moniteur ${cle}`, `${cle}@harvest-kids.test`],
  );
  await proprietaire.query(
    `INSERT INTO "Membre" (id, "egliseId", "userId", roles, "updatedAt")
     VALUES ($1, $2, $3, $4::"Role"[], now())`,
    [id, jeu.egliseId, `user_${cle}`, roles],
  );
  return id;
}

let moniteurA: string;
let accueilA: string;
let moniteurB: string;

beforeAll(async () => {
  base = creerClientPlateforme(urlsDeTest().app);
  proprietaire = await connecter("proprietaire");
});

afterAll(async () => {
  await base?.$disconnect();
  await proprietaire?.end();
});

beforeEach(async () => {
  await viderBase(proprietaire);
  a = await creerEglise(proprietaire, "a");
  b = await creerEglise(proprietaire, "b");
  moniteurA = await membre(a, "a_moniteur", ["MONITEUR"]);
  accueilA = await membre(a, "a_accueil", ["ACCUEIL"]);
  moniteurB = await membre(b, "b_moniteur", ["MONITEUR"]);
  dbA = clientEglise(base, a.egliseId);
  rendu.badges = [];
});

const auteurA = () => contexteVerifie(a);
const imprimer = (choix = {}) => imprimerBadges(base, dbA, auteurA(), EGLISE, choix);
const resoudre = (jeton: string, db: ClientEglise = dbA, jeu: Jeu = a) =>
  resoudreJeton(db, jeton, verificationMoniteur(base, contexteVerifie(jeu)));

/** Badges of church A, as the owner inside A. */
const badgesA = () =>
  enEglise(proprietaire, a.egliseId, async () => {
    const { rows } = await proprietaire.query<{
      id: string;
      membreId: string;
      revoque: boolean;
    }>(
      `SELECT id, "membreId", "revoqueLe" IS NOT NULL AS revoque FROM "BadgeMoniteur"
       WHERE "egliseId" = $1 ORDER BY "emisLe", id`,
      [a.egliseId],
    );
    return rows;
  });

const auditA = (action: string) =>
  dbA.auditLog.findMany({
    where: { action },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { entite: true, entiteId: true, avant: true, apres: true },
  });

describe("impression et cycle des badges", () => {
  it("imprime le badge de chaque moniteur actif, actif tout de suite, avec audit", async () => {
    const { pdf, badges } = await imprimer();
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(badges).toBe(1);
    // Only monitors get a badge: the reception member is not listed.
    expect(rendu.badges.map((c) => c.moniteur)).toEqual(["Moniteur a_moniteur"]);
    expect(await badgesA()).toEqual([
      { id: expect.any(String), membreId: moniteurA, revoque: false },
    ]);
    expect(await resoudre(rendu.badges[0]!.jeton)).toEqual({
      statut: "active",
      type: "badge",
      badgeId: (await badgesA())[0]!.id,
      membreId: moniteurA,
    });
    expect(await auditA("badge.emis")).toHaveLength(1);
    expect((await listerMoniteurs(base, auteurA()))[0]!.badgeEmisLe).toBeInstanceOf(Date);
  });

  it("RG-03 : une réimpression remplace le badge ; l'ancien est refusé avec son message", async () => {
    await imprimer();
    const ancien = rendu.badges[0]!.jeton;
    await imprimer({ membreIds: [moniteurA] });
    const nouveau = rendu.badges[0]!.jeton;

    expect((await badgesA()).map((x) => x.revoque)).toEqual([true, false]);
    expect(await resoudre(ancien)).toEqual({ statut: "badge_remplace" });
    expect(MESSAGES_SCAN.badge_remplace).toBe(
      "Ce badge a été remplacé. Utilisez votre nouveau badge ou sélectionnez-vous dans la liste.",
    );
    expect(await resoudre(nouveau)).toMatchObject({ statut: "active", membreId: moniteurA });
    expect(await auditA("badge.revoque")).toEqual([
      expect.objectContaining({ entite: "BadgeMoniteur", apres: { raison: "remplace" } }),
    ]);
  });

  it("la base refuse un second badge non révoqué pour un membre (index partiel)", async () => {
    await imprimer();
    const code = await codeErreur(
      enEglise(proprietaire, a.egliseId, () =>
        proprietaire.query(
          `INSERT INTO "BadgeMoniteur" (id, "egliseId", "membreId", "tokenHash")
           VALUES ('badge_double', $1, $2, repeat('a', 64))`,
          [a.egliseId, moniteurA],
        ),
      ),
    );
    expect(code).toBe("23505");
  });

  it("un rendu PDF en échec n'émet aucun badge", async () => {
    rendu.echoue = true;
    try {
      await expect(imprimer()).rejects.toThrow("rendu impossible");
    } finally {
      rendu.echoue = false;
    }
    expect(await badgesA()).toEqual([]);
  });

  it("refuse un membre qui n'est pas moniteur, sans rien écrire", async () => {
    await expect(imprimer({ membreIds: [accueilA] })).rejects.toThrow(ImpressionBadgesRefusee);
    await expect(
      emettreBadges(base, auteurA(), [
        { membreId: accueilA, jeton: "HKB1.AAAAAAAAAAAAAAAAAAAAAA" },
      ]),
    ).rejects.toThrow(BadgeImpossible);
    expect(await badgesA()).toEqual([]);
  });
});

describe("membre désactivé ou qui perd le rôle MONITEUR", () => {
  it("désactivation : badge révoqué dans la même transaction, avec audit, et refusé au scan", async () => {
    await imprimer();
    const jeton = rendu.badges[0]!.jeton;
    const resultat = await modifierMembre(base, auteurA(), moniteurA, { actif: false });
    expect(resultat).toEqual({ badgesRevoques: [(await badgesA())[0]!.id] });

    expect((await badgesA()).map((x) => x.revoque)).toEqual([true]);
    expect(await resoudre(jeton)).toEqual({ statut: "badge_refuse" });
    expect(MESSAGES_SCAN.badge_refuse).toBe(
      "Ce badge n'est plus valide : son titulaire n'est plus moniteur actif dans cette église. Adressez-vous à un administrateur.",
    );
    expect(await auditA("membre.modifie")).toEqual([
      {
        entite: "Membre",
        entiteId: moniteurA,
        avant: { roles: ["MONITEUR"], actif: true },
        apres: { roles: ["MONITEUR"], actif: false },
      },
    ]);
    expect(await auditA("badge.revoque")).toEqual([
      expect.objectContaining({ apres: { raison: "membre_desactive" } }),
    ]);
  });

  it("perte du rôle MONITEUR : badge révoqué, avec audit, et refusé au scan", async () => {
    await imprimer();
    const jeton = rendu.badges[0]!.jeton;
    await modifierMembre(base, auteurA(), moniteurA, { roles: ["ACCUEIL"] });
    expect((await badgesA()).map((x) => x.revoque)).toEqual([true]);
    expect(await resoudre(jeton)).toEqual({ statut: "badge_refuse" });
    expect(await auditA("badge.revoque")).toEqual([
      expect.objectContaining({ apres: { raison: "role_moniteur_retire" } }),
    ]);
  });

  it("un changement qui garde le rôle MONITEUR ne touche pas au badge", async () => {
    await imprimer();
    await modifierMembre(base, auteurA(), moniteurA, { roles: ["MONITEUR", "ACCUEIL"] });
    expect((await badgesA()).map((x) => x.revoque)).toEqual([false]);
    expect(await auditA("badge.revoque")).toEqual([]);
  });

  it("un badge actif d'un membre devenu inactif hors application est refusé au scan, en lecture seule", async () => {
    await imprimer();
    const jeton = rendu.badges[0]!.jeton;
    await proprietaire.query(`UPDATE "Membre" SET actif = false WHERE id = $1`, [moniteurA]);
    expect(await resoudre(jeton)).toEqual({ statut: "badge_refuse" });
    // The scan writes nothing: the badge stays as it was.
    expect((await badgesA()).map((x) => x.revoque)).toEqual([false]);
  });

  it("une modification invalide ne change rien", async () => {
    await imprimer();
    await expect(modifierMembre(base, auteurA(), moniteurA, { roles: [] })).rejects.toThrow();
    expect((await badgesA()).map((x) => x.revoque)).toEqual([false]);
    expect(await auditA("membre.modifie")).toEqual([]);
  });
});

describe("isolation A/B", () => {
  it("RG-14 : un badge de B, même révoqué, scanné dans A appartient à une autre église", async () => {
    const dbB = clientEglise(base, b.egliseId);
    await imprimerBadges(base, dbB, contexteVerifie(b), EGLISE);
    const jetonB = rendu.badges[0]!.jeton;
    expect(await resoudre(jetonB)).toEqual({ statut: "autre_eglise" });
    await modifierMembre(base, contexteVerifie(b), moniteurB, { actif: false });
    expect(await resoudre(jetonB)).toEqual({ statut: "autre_eglise" });
    // In B, it is B's own badge, refused because its holder is no longer a monitor.
    expect(await resoudre(jetonB, dbB, b)).toEqual({ statut: "badge_refuse" });
  });

  it("A ne peut ni imprimer le badge d'un moniteur de B, ni modifier ce membre", async () => {
    await expect(imprimer({ membreIds: [moniteurB] })).rejects.toThrow(
      "Moniteur introuvable. Rechargez la page.",
    );
    await expect(
      emettreBadges(base, auteurA(), [
        { membreId: moniteurB, jeton: "HKB1.BBBBBBBBBBBBBBBBBBBBBB" },
      ]),
    ).rejects.toThrow(BadgeImpossible);
    expect(await modifierMembre(base, auteurA(), moniteurB, { actif: false })).toBeNull();
    const { rows } = await proprietaire.query(`SELECT actif FROM "Membre" WHERE id = $1`, [
      moniteurB,
    ]);
    expect(rows).toEqual([{ actif: true }]);
    const dansB = await enEglise(proprietaire, b.egliseId, () =>
      proprietaire.query(`SELECT count(*)::int AS n FROM "BadgeMoniteur" WHERE "egliseId" = $1`, [
        b.egliseId,
      ]),
    );
    expect(dansB.rows[0].n).toBe(0);
  });
});

/**
 * Lot 2, step 5b: a second person confirms on the agent's tablet with their own PIN (cahier
 * §7.6: retrieval without card or code, exceptional retrieval). Another account than the
 * agent's, an active member of the church with one of the roles required; failures count
 * against the same PIN counter as unlocking.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { MAX_ECHECS_PIN } from "@/lib/pin";
import { hacherPin } from "@/server/plateforme/comptes";
import { creerClientPlateforme } from "@/server/plateforme/db";
import {
  ROLES_SECOND_MEMBRE,
  confirmerAvecPin,
  membresConfirmateurs,
} from "@/server/plateforme/pin";
import { type Client, type Jeu, connecter, creerEglise, viderBase } from "./support/db";
import { urlsDeTest } from "./support/urls";

let base: PrismaClient;
let proprietaire: Client;
let a: Jeu;
let b: Jeu;
let hash: string;

const PIN = "482913";

/** A member of the church with the given roles and the test PIN. */
async function membre(jeu: Jeu, cle: string, roles: string[], etat: { actif?: boolean } = {}) {
  await proprietaire.query(
    `INSERT INTO "User" (id, name, email, "updatedAt") VALUES ($1, $2, $3, now())`,
    [`user_${cle}`, `Membre ${cle}`, `${cle}@harvest-kids.test`],
  );
  await proprietaire.query(
    `INSERT INTO "Membre" (id, "egliseId", "userId", roles, actif, "pinHash", "updatedAt")
     VALUES ($1, $2, $3, $4::"Role"[], $5, $6, now())`,
    [`membre_${cle}`, jeu.egliseId, `user_${cle}`, roles, etat.actif ?? true, hash],
  );
  return { membreId: `membre_${cle}`, userId: `user_${cle}` };
}

const demande = (jeu: Jeu, membreId: string, agentUserId = "user_agent") => ({
  egliseId: jeu.egliseId,
  membreId,
  agentUserId,
  roles: ROLES_SECOND_MEMBRE,
});

const etatPin = async (membreId: string) =>
  (
    await proprietaire.query(
      `SELECT "pinEchecs", "pinBloqueJusqua" IS NOT NULL AS bloque FROM "Membre" WHERE id = $1`,
      [membreId],
    )
  ).rows[0] as { pinEchecs: number; bloque: boolean };

beforeAll(async () => {
  base = creerClientPlateforme(urlsDeTest().app);
  proprietaire = await connecter("proprietaire");
  hash = await hacherPin(PIN);
});

afterAll(async () => {
  await base?.$disconnect();
  await proprietaire?.end();
});

beforeEach(async () => {
  await viderBase(proprietaire);
  a = await creerEglise(proprietaire, "a");
  b = await creerEglise(proprietaire, "b");
});

describe("confirmation par le PIN d'un second membre", () => {
  it("confirme un collègue de l'accueil, actif, avec son PIN", async () => {
    const collegue = await membre(a, "collegue", ["ACCUEIL"]);
    expect(await confirmerAvecPin(base, demande(a, collegue.membreId), PIN, new Date())).toEqual({
      statut: "confirme",
      userId: collegue.userId,
      membreId: collegue.membreId,
      nom: "Membre collegue",
    });
  });

  it("refuse le compte de l'agent lui-même, même avec le bon PIN", async () => {
    const agent = await membre(a, "agent", ["ACCUEIL"]);
    expect(
      await confirmerAvecPin(base, demande(a, agent.membreId, agent.userId), PIN, new Date()),
    ).toEqual({ statut: "meme_compte" });
    expect(await etatPin(agent.membreId)).toEqual({ pinEchecs: 0, bloque: false });
  });

  it("refuse un moniteur, un membre inactif et un membre d'une autre église", async () => {
    const moniteur = await membre(a, "moniteur", ["MONITEUR"]);
    const inactif = await membre(a, "inactif", ["RESPONSABLE"], { actif: false });
    const autre = await membre(b, "autre", ["ADMIN"]);
    for (const membreId of [moniteur.membreId, inactif.membreId, autre.membreId]) {
      expect(await confirmerAvecPin(base, demande(a, membreId), PIN, new Date())).toEqual({
        statut: "non_autorise",
      });
    }
  });

  it("compte les PIN erronés dans le compteur partagé : bloqué au cinquième, remis à zéro par un bon PIN", async () => {
    const collegue = await membre(a, "collegue", ["RESPONSABLE"]);
    expect(
      await confirmerAvecPin(base, demande(a, collegue.membreId), "111222", new Date()),
    ).toEqual({ statut: "incorrect", essaisRestants: MAX_ECHECS_PIN - 1 });
    expect(
      await confirmerAvecPin(base, demande(a, collegue.membreId), PIN, new Date()),
    ).toMatchObject({ statut: "confirme" });
    expect(await etatPin(collegue.membreId)).toEqual({ pinEchecs: 0, bloque: false });

    for (let i = 1; i < MAX_ECHECS_PIN; i++) {
      await confirmerAvecPin(base, demande(a, collegue.membreId), "111222", new Date());
    }
    expect(
      await confirmerAvecPin(base, demande(a, collegue.membreId), "111222", new Date()),
    ).toEqual({ statut: "bloque" });
    // Blocked: even the right PIN is refused (the same counter blocks the tablet unlock).
    expect(await confirmerAvecPin(base, demande(a, collegue.membreId), PIN, new Date())).toEqual({
      statut: "bloque",
    });
    expect(await etatPin(collegue.membreId)).toMatchObject({ bloque: true });
  });

  it("liste les collègues qui peuvent confirmer : ni l'agent, ni un moniteur, ni un compte sans PIN, ni une autre église", async () => {
    const agent = await membre(a, "agent", ["ACCUEIL"]);
    await membre(a, "collegue", ["ACCUEIL"]);
    await membre(a, "resp", ["RESPONSABLE", "MONITEUR"]);
    await membre(a, "moniteur", ["MONITEUR"]);
    await membre(b, "autre", ["ADMIN"]);
    const sansPin = await membre(a, "sanspin", ["ADMIN"]);
    await proprietaire.query(`UPDATE "Membre" SET "pinHash" = NULL WHERE id = $1`, [
      sansPin.membreId,
    ]);

    expect(
      await membresConfirmateurs(base, {
        egliseId: a.egliseId,
        agentUserId: agent.userId,
        roles: ROLES_SECOND_MEMBRE,
      }),
    ).toEqual([
      { membreId: "membre_collegue", nom: "Membre collegue" },
      { membreId: "membre_resp", nom: "Membre resp" },
    ]);
  });
});

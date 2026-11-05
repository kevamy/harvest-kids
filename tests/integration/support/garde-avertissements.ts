import { afterEach, expect } from "vitest";

/**
 * Fails the test during which pg warns that a query was sent on a connection already busy
 * with another one: queued by pg 8, refused by pg 9 (see sequentielle() in
 * src/server/plateforme/db.ts). pg emits this warning once per process, so the first
 * occurrence is the one to catch.
 */
const MOTIF = /client is already executing a query/;
const recus: string[] = [];
const globale = globalThis as { hkGardeAvertissements?: true };

if (!globale.hkGardeAvertissements) {
  globale.hkGardeAvertissements = true;
  process.on("warning", (avertissement) => {
    if (MOTIF.test(avertissement.message)) {
      recus.push(
        `${expect.getState().currentTestName ?? "hors d'un test"} : ${avertissement.stack}`,
      );
    }
  });
}

afterEach(async () => {
  // Node emits warnings on the next tick.
  await new Promise((resolve) => setImmediate(resolve));
  if (recus.length > 0) {
    throw new Error(
      `Requêtes pg simultanées sur une même connexion :\n${recus.splice(0).join("\n")}`,
    );
  }
});

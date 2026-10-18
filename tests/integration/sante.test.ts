/**
 * /api/sante: healthy only when connected as hk_app, never as the owner role
 * (which owns the tables and could disable Row-Level Security).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { urlsDeTest } from "./support/urls";

async function santeAvec(url: string) {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-".padEnd(40, "x"));
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  const { prismaPlateforme } = await import("@/server/plateforme/db");
  const { GET } = await import("@/app/api/sante/route");
  try {
    const reponse = await GET();
    return { statut: reponse.status, corps: await reponse.json() };
  } finally {
    await prismaPlateforme().$disconnect();
    delete (globalThis as { prismaPlateforme?: unknown }).prismaPlateforme;
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("route /api/sante", () => {
  it("répond 200 avec le rôle applicatif hk_app", async () => {
    expect(await santeAvec(urlsDeTest().app)).toEqual({ statut: 200, corps: { ok: true } });
  });

  it("répond 503 si l'application est connectée avec le rôle propriétaire", async () => {
    expect(await santeAvec(urlsDeTest().migration)).toEqual({
      statut: 503,
      corps: { ok: false, raison: "role_interdit" },
    });
  });

  it("répond 503 sans dévoiler l'erreur si la base est injoignable", async () => {
    const injoignable = new URL(urlsDeTest().app);
    injoignable.port = "1";
    expect(await santeAvec(injoignable.toString())).toEqual({
      statut: 503,
      corps: { ok: false, raison: "base_injoignable" },
    });
  });
});

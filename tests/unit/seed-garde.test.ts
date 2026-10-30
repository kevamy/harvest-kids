import { describe, expect, it } from "vitest";
import { autorisationSeed } from "../../prisma/seed-garde";

const local = "postgresql://hk_app:x@localhost:5432/harvest_kids";
const neon = "postgresql://hk_app:x@ep-exemple-pooler.eu-central-1.aws.neon.tech/neondb";

describe("garde du seed de démonstration", () => {
  it("autorise une base locale sans condition (développement, CI)", () => {
    expect(autorisationSeed({ DATABASE_URL: local })).toEqual({ autorise: true });
    expect(
      autorisationSeed({ DATABASE_URL: "postgresql://a:b@127.0.0.1/harvest_kids" }).autorise,
    ).toBe(true);
  });

  it("refuse une base distante sans HK_SEED_DEMO=autorise", () => {
    const decision = autorisationSeed({
      DATABASE_URL: neon,
      SEED_MOT_DE_PASSE: "Choisi-long-2026",
    });
    expect(decision.autorise).toBe(false);
  });

  it("refuse une base distante avec le mot de passe par défaut ou trop court", () => {
    expect(autorisationSeed({ DATABASE_URL: neon, HK_SEED_DEMO: "autorise" }).autorise).toBe(false);
    expect(
      autorisationSeed({ DATABASE_URL: neon, HK_SEED_DEMO: "autorise", SEED_MOT_DE_PASSE: "court" })
        .autorise,
    ).toBe(false);
  });

  it("autorise une base distante avec l'autorisation et un mot de passe choisi", () => {
    expect(
      autorisationSeed({
        DATABASE_URL: neon,
        HK_SEED_DEMO: "autorise",
        SEED_MOT_DE_PASSE: "Choisi-long-2026",
      }),
    ).toEqual({ autorise: true });
  });

  it("refuse le conteneur de base du VPS (hôte db) sans autorisation", () => {
    expect(
      autorisationSeed({ DATABASE_URL: "postgresql://hk_app:x@db:5432/harvest_kids" }).autorise,
    ).toBe(false);
  });

  it("refuse une adresse absente ou invalide", () => {
    expect(autorisationSeed({}).autorise).toBe(false);
    expect(autorisationSeed({ DATABASE_URL: "pas une url" }).autorise).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const valide = {
  DATABASE_URL: "postgresql://hk_app:secret@localhost:5432/harvest_kids",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("applique les valeurs par défaut", () => {
    const env = parseEnv(valide);
    expect(env.STORAGE_DRIVER).toBe("local");
    expect(env.DEFAULT_TIMEZONE).toBe("Africa/Porto-Novo");
    expect(env.UPLOADS_DIR).toBe("./uploads");
  });

  it("traite une chaîne vide comme absente", () => {
    expect(
      parseEnv({ ...valide, SENTRY_DSN: "", SUPER_ADMIN_EMAIL: "" }).SENTRY_DSN,
    ).toBeUndefined();
  });

  it("refuse une configuration incomplète sans exposer les valeurs", () => {
    const secret = "postgresql://hk_app:motdepasse-tres-secret@db/hk";
    expect(() => parseEnv({ DATABASE_URL: secret })).toThrow(/BETTER_AUTH_SECRET/);
    try {
      parseEnv({ DATABASE_URL: secret });
    } catch (error) {
      expect(String(error)).not.toContain("motdepasse-tres-secret");
    }
  });

  it("exige le jeton Vercel Blob avec le pilote vercel-blob", () => {
    expect(() => parseEnv({ ...valide, STORAGE_DRIVER: "vercel-blob" })).toThrow(
      /BLOB_READ_WRITE_TOKEN/,
    );
    expect(
      parseEnv({ ...valide, STORAGE_DRIVER: "vercel-blob", BLOB_READ_WRITE_TOKEN: "tok" })
        .STORAGE_DRIVER,
    ).toBe("vercel-blob");
  });
});

import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

// The first lint loads the whole TypeScript toolchain (up to ~2 min on a cold disk).
beforeAll(async () => {
  await eslint.lintText("export {};\n", { filePath: "src/lib/rechauffage.ts" });
}, 300_000);

async function erreurs(code: string, fichier: string) {
  const [resultat] = await eslint.lintText(code, { filePath: fichier });
  return (resultat?.messages ?? [])
    .filter((m) => m.ruleId === "no-restricted-imports")
    .map((m) => m.message);
}

const IMPORT_CLIENT = `import { PrismaClient } from "@/generated/prisma/client";\nexport const c = PrismaClient;\n`;
const IMPORT_PLATEFORME = `import { prismaPlateforme } from "@/server/plateforme/db";\nexport const p = prismaPlateforme;\n`;

describe("règle ESLint : accès brut à la base", () => {
  it.each([
    ["src/app/page.tsx", IMPORT_CLIENT],
    ["src/server/familles.ts", IMPORT_CLIENT],
    ["src/components/hk/child-card.tsx", IMPORT_PLATEFORME],
    ["src/app/api/sante/route.ts", `import pg from "pg";\nexport const x = pg;\n`],
  ])("refuse l'import dans %s", async (fichier, code) => {
    expect(await erreurs(code, fichier)).toHaveLength(1);
  });

  it.each([
    ["src/lib/tenant.ts", IMPORT_CLIENT],
    ["src/server/plateforme/eglises.ts", IMPORT_PLATEFORME],
    ["src/lib/auth.ts", IMPORT_PLATEFORME],
    ["prisma/seed.ts", IMPORT_CLIENT],
  ])("autorise l'import dans %s", async (fichier, code) => {
    expect(await erreurs(code, fichier)).toEqual([]);
  });

  it("autorise partout l'import des seuls types et enums", async () => {
    const code = `import type { Role } from "@/generated/prisma/client";\nexport type R = Role;\n`;
    expect(await erreurs(code, "src/lib/rbac.ts")).toEqual([]);
  });
});

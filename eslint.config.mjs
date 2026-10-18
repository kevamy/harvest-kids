import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Church data is only reached through getTenantDb() (src/lib/tenant.ts). The raw
// Prisma client and the database driver are restricted to a few audited files.
const ACCES_BRUT_INTERDIT = {
  patterns: [
    {
      group: ["@/generated/prisma/client", "**/generated/prisma/client", "@prisma/client"],
      allowTypeImports: true,
      message:
        "Client Prisma brut interdit ici : passez par getTenantDb() (src/lib/tenant.ts). Les types et enums restent importables.",
    },
    {
      group: ["@/server/plateforme/db", "**/server/plateforme/db"],
      allowTypeImports: true,
      message:
        "Accès base de plateforme interdit ici : passez par getTenantDb() (src/lib/tenant.ts).",
    },
    {
      group: ["pg", "@prisma/adapter-pg"],
      message: "Pilote PostgreSQL interdit ici : passez par getTenantDb() (src/lib/tenant.ts).",
    },
  ],
};

// Files allowed to reach the database directly (CLAUDE.md, ADR 0002).
const FICHIERS_ACCES_BRUT_AUTORISE = [
  "src/server/plateforme/**",
  "src/lib/tenant.ts",
  "src/lib/auth.ts",
  "prisma/seed.ts",
  "tests/**",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,mts,js,mjs}"],
    ignores: FICHIERS_ACCES_BRUT_AUTORISE,
    rules: {
      "no-restricted-imports": ["error", ACCES_BRUT_INTERDIT],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;

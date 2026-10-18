import { defineConfig } from "prisma/config";

// Node 22 reads .env natively (no dotenv dependency); absent in CI and in production.
try {
  process.loadEnvFile();
} catch {
  // no .env file: variables come from the environment
}

// Migrations run with the OWNER role. The application never uses this URL:
// it connects as hk_app (DATABASE_URL), which is subject to Row-Level Security.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_MIGRATION_URL ?? "",
  },
});

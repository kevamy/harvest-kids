import { execSync } from "node:child_process";
import { urlsDeTest } from "./urls";

/** Applies the migrations to the dedicated test database, once per run. */
export default function setup() {
  const { migration } = urlsDeTest();
  execSync("pnpm exec prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_MIGRATION_URL: migration },
  });
}

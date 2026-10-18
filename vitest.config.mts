import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));
const serverOnly = fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": src,
      // Tests run on the server side: the marker package must not throw.
      "server-only": serverOnly,
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          // Integration tests share one PostgreSQL database.
          fileParallelism: false,
          globalSetup: ["tests/integration/support/global-setup.ts"],
          testTimeout: 20_000,
        },
      },
    ],
  },
});

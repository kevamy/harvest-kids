try {
  process.loadEnvFile();
} catch {
  // CI: variables come from the environment
}

/**
 * Test database URLs. Integration tests empty this database: it must never be the
 * development or a shared database.
 */
export function urlsDeTest() {
  const app = process.env.TEST_DATABASE_URL;
  const migration = process.env.TEST_DATABASE_MIGRATION_URL;
  if (!app || !migration) {
    throw new Error("TEST_DATABASE_URL et TEST_DATABASE_MIGRATION_URL sont obligatoires.");
  }
  for (const url of [app, migration]) {
    if (!new URL(url).pathname.endsWith("_test")) {
      throw new Error("La base des tests d'intégration doit avoir un nom terminé par _test.");
    }
  }
  return { app, migration };
}

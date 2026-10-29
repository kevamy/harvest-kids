import "server-only";
import { z } from "zod";

/**
 * Server environment, validated once on first use.
 * Parsing is lazy so `next build` does not require runtime secrets.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // Application role, subject to Row-Level Security.
    DATABASE_URL: z.url(),
    // Owner role, used only by `prisma migrate`.
    DATABASE_MIGRATION_URL: z.url().optional(),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET doit faire au moins 32 caractères"),
    BETTER_AUTH_URL: z.url(),
    STORAGE_DRIVER: z.enum(["local", "vercel-blob"]).default("local"),
    BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
    UPLOADS_DIR: z.string().min(1).default("./uploads"),
    DEFAULT_TIMEZONE: z.string().min(1).default("Africa/Porto-Novo"),
    SUPER_ADMIN_EMAIL: z.email().optional(),
    SENTRY_DSN: z.url().optional(),
  })
  .refine((env) => env.STORAGE_DRIVER !== "vercel-blob" || env.BLOB_READ_WRITE_TOKEN, {
    // A Vercel Blob store only injects BLOB_STORE_ID: the token is added by hand.
    message:
      "BLOB_READ_WRITE_TOKEN est obligatoire avec STORAGE_DRIVER=vercel-blob (à ajouter à la main dans Vercel, voir docs/exploitation.md)",
    path: ["BLOB_READ_WRITE_TOKEN"],
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Empty strings (common in .env files) count as missing.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ""),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    // Only variable names and messages are reported, never values.
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuration invalide :\n${details}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

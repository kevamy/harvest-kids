import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import type { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { prismaPlateforme } from "@/server/plateforme/db";

/**
 * Authentication (ADR 0003). Better Auth only authenticates: church membership
 * and roles live in Membre, and the active church in AuthSession.egliseActiveId.
 * Accounts are created by administrators, never by public sign-up.
 */
export function creerAuth(options: {
  prisma: PrismaClient;
  secret: string;
  baseURL: string;
  /** Sets cookies from Server Actions; off outside a Next.js request (tests). */
  cookiesNext?: boolean;
}) {
  const { prisma } = options;
  const production = process.env.NODE_ENV === "production";

  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: [options.baseURL],
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    telemetry: { enabled: false },

    user: {
      modelName: "user",
      additionalFields: {
        telephone: { type: "string", required: false, input: false },
        superAdmin: { type: "boolean", required: false, defaultValue: false, input: false },
        actif: { type: "boolean", required: false, defaultValue: true, input: false },
      },
    },
    session: {
      modelName: "authSession",
      // A service day; inactivity is handled by the PIN lock (15 min).
      expiresIn: 60 * 60 * 12,
      updateAge: 60 * 60,
      additionalFields: {
        egliseActiveId: { type: "string", required: false, input: false },
        derniereActivite: { type: "date", required: false, input: false },
      },
    },
    account: { modelName: "authAccount" },
    verification: { modelName: "authVerification" },

    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      autoSignIn: false,
    },

    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "authRateLimit",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 15 * 60, max: 10 },
      },
    },

    advanced: {
      cookiePrefix: "hk",
      useSecureCookies: production,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: production },
    },

    databaseHooks: {
      session: {
        create: {
          // A deactivated account cannot open a session. With a single active
          // membership, the church is selected right away.
          async before(session) {
            const user = await prisma.user.findUnique({
              where: { id: session.userId },
              select: {
                actif: true,
                membres: {
                  where: { actif: true, eglise: { statut: "ACTIVE" } },
                  select: { egliseId: true },
                },
              },
            });
            if (!user?.actif) return false;
            const egliseActiveId = user.membres.length === 1 ? user.membres[0]!.egliseId : null;
            return { data: { ...session, egliseActiveId, derniereActivite: new Date() } };
          },
        },
      },
    },

    plugins: options.cookiesNext === false ? [] : [nextCookies()],
  });
}

export type Auth = ReturnType<typeof creerAuth>;

let instance: Auth | undefined;

/** Lazy, so that `next build` does not need the runtime secrets. */
export function getAuth(): Auth {
  instance ??= creerAuth({
    prisma: prismaPlateforme(),
    secret: env().BETTER_AUTH_SECRET,
    baseURL: env().BETTER_AUTH_URL,
  });
  return instance;
}

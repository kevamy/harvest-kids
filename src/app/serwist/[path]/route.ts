import { createSerwistRoute } from "@serwist/turbopack";

// Bumped on every build so the offline page is refreshed with each deployment.
const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: "src/app/sw.ts",
    additionalPrecacheEntries: [{ url: "/hors-connexion", revision }],
    useNativeEsbuild: true,
  },
);

import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  // Same build for Vercel (test) and the Docker image on the VPS (production).
  output: "standalone",
  // sharp loads libvips from separate packages (@img/sharp-<platform>, @img/sharp-libvips-<platform>)
  // that output tracing misses: without them the standalone build cannot convert a logo.
  // Whatever the platform (Windows locally, Linux on Vercel and in Docker).
  outputFileTracingIncludes: {
    "/**": ["./node_modules/.pnpm/@img+sharp*/node_modules/@img/**/*"],
  },
  experimental: {
    // Logo uploads (2 MB max) go through Server Actions. Stay well under the 4.5 MB
    // request limit of Vercel functions; photos are downscaled in the browser first.
    serverActions: { bodySizeLimit: "3mb" },
  },
  // Cache Components stays off: every screen reads the session and the active
  // church; a server cache keyed on the wrong value could leak one church's
  // data to another (see docs/decisions/0001-stack-et-versions.md).
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withSerwist(nextConfig);

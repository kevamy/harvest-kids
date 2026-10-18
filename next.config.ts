import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  // Same build for Vercel (test) and the Docker image on the VPS (production).
  output: "standalone",
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

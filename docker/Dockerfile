# Production image (VPS). Same standalone build as Vercel; built from the
# repository root: docker build -f docker/Dockerfile .
FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# openssl: required by Prisma's schema engine (migrations).
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@12.14.0 --activate
WORKDIR /app

# Dependencies (postinstall generates the Prisma client; `pnpm build` regenerates it
# so the build never depends on an install step having run).
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

# One-shot job: applies pending migrations with the owner role, then exits.
# It contains no seed: demonstration data never reaches production.
FROM deps AS migrate
USER node
# Prisma is called directly: `pnpm exec` would try to reinstall at run time.
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    STORAGE_DRIVER=local \
    UPLOADS_DIR=/data/uploads
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
RUN mkdir -p /data/uploads && chown node:node /data/uploads
VOLUME ["/data/uploads"]
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/sante').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]

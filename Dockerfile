# syntax=docker/dockerfile:1.7
# One image for the API (which also serves the built web app) and the worker. FFmpeg is included for video processing.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ai/package.json packages/ai/
COPY packages/social/package.json packages/social/
COPY packages/integrations/package.json packages/integrations/
COPY packages/engine/package.json packages/engine/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @socialpilot/db generate \
 && pnpm --filter @socialpilot/web build \
 && pnpm --filter @socialpilot/api build \
 && pnpm --filter @socialpilot/worker build

FROM base AS runtime
ENV NODE_ENV=production STORAGE_DIR=/data/storage
COPY --from=build /app /app
RUN mkdir -p /data/storage && chown -R node:node /data /app
USER node
EXPOSE 4000
# Default: API. The worker service overrides the command.
CMD ["sh", "-c", "pnpm --filter @socialpilot/db migrate:deploy && node apps/api/dist/index.js"]

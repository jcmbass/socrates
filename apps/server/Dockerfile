# apps/server Dockerfile — C2 (WP5), DF-6: host-agnostic (Fly.io/Railway/any
# Docker host), NOT tied to Vercel/serverless. Multi-stage, non-root runtime
# user, npm workspaces monorepo aware.
#
# BUILD CONTEXT MUST BE THE REPO ROOT (this Dockerfile needs packages/core,
# packages/domain, packages/models, and the root package-lock.json — a
# monorepo lockfile can't be resolved from apps/server alone):
#
#   docker build -f apps/server/Dockerfile -t buxo-server .
#
# Migrations are NOT run automatically on container start (avoids races
# between multiple instances migrating concurrently on deploy) — run
# `npm run db:migrate -w apps/server` as a separate one-off step/job against
# DATABASE_URL before rolling out a new image.

FROM node:22-alpine AS base
WORKDIR /repo

# ---- deps: install exactly what the lockfile says, across every workspace ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/models/package.json packages/models/package.json
COPY packages/pdf/package.json packages/pdf/package.json
RUN npm ci

# ---- build: compile apps/server's TypeScript to dist/ ----
FROM deps AS build
COPY packages/core packages/core
COPY packages/domain packages/domain
COPY packages/models packages/models
COPY packages/pdf packages/pdf
COPY apps/server apps/server
RUN npm run build -w apps/server
# Drop devDependencies from node_modules before copying into the runtime
# image — smaller image, smaller attack surface. `packages/*` are consumed
# as raw .ts sources (workspace symlinks, no build step of their own) per
# their own package.json ("Consumers transpile the .ts sources directly")
# — apps/server's build output only needs `ai`, `zod`, etc. transitively,
# which `npm prune` correctly keeps.
RUN npm prune --omit=dev

# ---- runtime: minimal, non-root ----
FROM base AS runtime
ENV NODE_ENV=production
RUN addgroup -S buxo && adduser -S buxo -G buxo

COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/packages /repo/packages
COPY --from=build /repo/apps/server/dist /repo/apps/server/dist
COPY --from=build /repo/apps/server/migrations /repo/apps/server/migrations
COPY --from=build /repo/apps/server/package.json /repo/apps/server/package.json

WORKDIR /repo/apps/server
USER buxo

EXPOSE 3001
CMD ["node", "dist/index.js"]

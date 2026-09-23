# Built from the repo root: the API imports @catwalks/db, so the workspace
# must be present. Alpine is fine here — unlike the aggregator, no Chromium.
FROM node:22-alpine AS builder
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/
COPY packages/runtime/package.json packages/runtime/
COPY apps/api/package.json apps/api/
COPY apps/aggregator/package.json apps/aggregator/
RUN npm ci --workspaces --include-workspace-root
COPY packages/db packages/db
COPY apps/api apps/api
COPY packages/runtime packages/runtime
COPY docs/operations/railway/runtime-target.json docs/operations/railway/runtime-target.json
ARG CATWALKS_BUILD_SHA
ARG RAILWAY_GIT_COMMIT_SHA
ENV NEXT_PUBLIC_SITE_URL=https://catwalks.io
RUN node packages/runtime/seal.mjs
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
RUN npm run build -w @catwalks/api

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# `output: standalone` bundles only the server files actually reached.
COPY --from=builder --chown=node:node /repo/apps/api/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/api/.next/static ./apps/api/.next/static
COPY --from=builder --chown=node:node /repo/apps/api/public ./apps/api/public
COPY --from=builder --chown=node:node /repo/packages/runtime ./packages/runtime
COPY --from=builder --chown=node:node /repo/docs/operations/railway/runtime-target.json ./docs/operations/railway/runtime-target.json
COPY --from=builder --chown=node:node /repo/apps/api/runtime ./apps/api/runtime
USER node
EXPOSE 8080
CMD ["node", "apps/api/runtime/start.mjs"]

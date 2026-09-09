# Built from the repo root: the web app imports @catwalks/db, so the workspace
# must be present. Alpine is fine here — unlike the aggregator, no Chromium.
FROM node:22-alpine AS builder
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
COPY apps/aggregator/package.json apps/aggregator/
RUN npm ci --workspaces --include-workspace-root
COPY packages/db packages/db
COPY apps/web apps/web
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
RUN npm run build -w @catwalks/web

# Only the locked database workspace dependencies are needed by the migration
# hook. Keep them separate from Next's standalone runtime and other workspaces.
FROM node:22-alpine AS migration-deps
WORKDIR /migration
COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/
RUN npm ci --workspace @catwalks/db --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# `output: standalone` bundles only the server files actually reached.
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --from=migration-deps --chown=node:node /migration/node_modules /migration/node_modules
COPY --from=builder --chown=node:node /repo/packages/db/prisma /migration/prisma
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

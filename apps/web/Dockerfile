# Built from the repo root: the web app imports @catwalks/db, so the workspace
# must be present. Alpine is fine here — unlike the aggregator, no Chromium.
FROM node:22-alpine AS builder
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
RUN npm install --workspaces --include-workspace-root
COPY packages/db packages/db
COPY apps/web apps/web
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
RUN npm run build -w @catwalks/web

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# `output: standalone` bundles only the server files actually reached.
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

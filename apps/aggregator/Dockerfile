# Browser-rendered career sites require Chromium and a glibc-based image.
FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/
COPY apps/aggregator/package.json apps/aggregator/
COPY apps/web/package.json apps/web/
RUN npm ci --workspaces --include-workspace-root
COPY packages/db packages/db
# Includes data/reference/maisons.csv — the 713-house reference list the sector filter
# reads at runtime. Without it every classification throws ENOENT.
COPY apps/aggregator apps/aggregator
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
# Validate the application layout and all required runtime references.
RUN npm run check:layout -w @catwalks/aggregator
# Migrations and catalogue imports are explicit release operations. Scheduled
# workers only verify schema readiness and run their configured command.
CMD ["sh", "apps/aggregator/start.sh"]

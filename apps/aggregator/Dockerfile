# FashionJobs sits behind Cloudflare and only answers a real browser engine, so
# the image ships Chromium. Alpine cannot be used: Playwright's browser builds
# are glibc-only and do not run on musl.
FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/
COPY apps/aggregator/package.json apps/aggregator/
RUN npm install --workspaces --include-workspace-root
COPY packages/db packages/db
COPY apps/aggregator apps/aggregator
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
# `db push` reconciles the schema at boot so a deploy that adds a table (JobSource,
# the geo columns) works without a manual migration step. It is idempotent, and it
# must run before the pipeline touches a relation that does not exist yet.
# Each cron service overrides the command after the `&&`.
CMD ["sh", "-c", "npx prisma db push --schema packages/db/prisma/schema.prisma --skip-generate --accept-data-loss && npm run ingest -w @catwalks/aggregator"]

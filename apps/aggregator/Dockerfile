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
# Includes data/maisons.csv — the 713-house reference list the sector filter
# reads at runtime. Without it every classification throws ENOENT.
COPY apps/aggregator apps/aggregator
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
# Fail the build rather than the 3am cron if the reference list went missing.
RUN test -f apps/aggregator/data/maisons.csv
# `db push` reconciles the schema at boot so a deploy that adds a table (JobSource,
# the geo columns) works without a manual migration step. It is idempotent, and it
# must run before the pipeline touches a relation that does not exist yet.
#
# The pipeline command is chosen by PIPELINE_CMD, set PER SERVICE (ingest-all for
# the ingest cron, refresh for the lifecycle cron, reconcile for the weekly one).
# A Dockerfile CMD takes precedence over Railway's RUN_COMMAND override, so the
# selection has to live here, read from the environment — not in a service field
# that is silently ignored. Defaults to ingest-all.
CMD ["sh", "-c", "npx prisma db push --schema packages/db/prisma/schema.prisma --skip-generate --accept-data-loss && npm run ${PIPELINE_CMD:-ingest-all} -w @catwalks/aggregator"]

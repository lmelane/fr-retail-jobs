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
# Versioned migrations, never `db push --accept-data-loss` (audit O-01, décision
# Loïc 2026-09-03): a schema mistake must fail the deploy, not silently drop
# production data three times a day. `migrate deploy` only applies reviewed
# migration files. The `resolve --applied` fallback baselines an EXISTING
# database once (first deploy after this change, P3005), then never runs again.
# Take a Postgres backup before the first deploy of this CMD.
#
# The pipeline command is chosen by PIPELINE_CMD, set PER SERVICE (ingest-all for
# the ingest cron, refresh for the lifecycle cron, reconcile for the weekly one).
# A Dockerfile CMD takes precedence over Railway's RUN_COMMAND override, so the
# selection has to live here, read from the environment — not in a service field
# that is silently ignored. Defaults to ingest-all.
CMD ["sh", "-c", "SCHEMA=packages/db/prisma/schema.prisma; (npx prisma migrate deploy --schema $SCHEMA || (npx prisma migrate resolve --schema $SCHEMA --applied 20260903000000_init && npx prisma migrate deploy --schema $SCHEMA)) && npm run ${PIPELINE_CMD:-ingest-all} -w @catwalks/aggregator"]

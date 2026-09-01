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
# Each cron service overrides this with its own command.
CMD ["npm", "run", "ingest", "-w", "@catwalks/aggregator"]

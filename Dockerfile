# FashionJobs is behind Cloudflare and only answers a real browser engine, so the
# image ships Chromium. Alpine is not usable here: Playwright's browser builds are
# glibc-only and do not run on musl.
FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm install && npx prisma generate
COPY tsconfig.json ./
COPY src ./src

# `db push` reconciles the schema at boot, so the first deploy creates the tables
# instead of failing on missing relations. It is idempotent on later runs.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run sync:all"]

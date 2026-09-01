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
CMD ["npm", "run", "sync:all"]

import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config for the critical candidate flows. Tests run against BASE_URL — a
 * deployed URL when E2E_BASE_URL is set (prod smoke), else a local `next start`
 * that Playwright boots itself against the fixtures DB (N-07: CI runs the built
 * app + seeded data, no silent skips). The server inherits DATABASE_URL, which
 * must point at the seeded *test* database.
 */
export default defineConfig({
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run start',
        port: 3009,
        env: { PORT: '3009' },
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3009',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});

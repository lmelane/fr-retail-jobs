import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config for the critical candidate flows. Tests run against BASE_URL — a
 * local dev server (default) or a deployed URL (E2E_BASE_URL), so the same suite
 * checks a branch locally and smoke-tests prod. No webServer block: the site
 * needs DATABASE_URL, so the caller starts the server (npm run web:dev) or points
 * at a running one — keeping the tests decoupled from DB provisioning.
 */
export default defineConfig({
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

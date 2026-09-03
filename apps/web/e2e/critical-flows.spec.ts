import { test, expect } from '@playwright/test';

/**
 * The candidate's critical path, end to end. These are deliberately behavioural,
 * not markup-brittle: they assert what a candidate must be able to DO — find the
 * search, run it, open an offer, see the two honest CTAs, reach a Maison, and get
 * the right HTTP status for a live vs. expired offer.
 */

test.describe('landing', () => {
  test('loads with a search field and the aggregator proof', async ({ page }) => {
    await page.goto('/');
    // The search pill is the whole point of the landing.
    await expect(page.getByPlaceholder(/poste|mot-clé/i)).toBeVisible();
    await expect(page.getByPlaceholder(/ville|région|pays/i)).toBeVisible();
    // The H1 exists (accessibility + SEO); the brand is present.
    await expect(page.locator('h1')).toBeVisible();
  });

  test('a search navigates to the results board', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder(/poste|mot-clé/i).fill('vendeur');
    await page.getByRole('button', { name: /rechercher/i }).click();
    await expect(page).toHaveURL(/\/emplois/);
  });
});

test.describe('results board', () => {
  test('shows offers and the filter bar, and selects a first offer', async ({ page }) => {
    await page.goto('/emplois');
    // The filter bar surfaces the real filters (D8/D19).
    await expect(page.getByRole('button', { name: /pays/i })).toBeVisible();
    // At least one offer card renders — on mobile the detail pane is hidden
    // (single column, cards route to /offre/[id]), so the card is the element
    // that exists on BOTH layouts.
    await expect(page.locator('.offer__title').first()).toBeVisible();
  });
});

/**
 * A board that answers empty IS the failure these tests exist to catch, so an
 * empty answer FAILS — no silent skip (N-07). Locally and in CI the fixtures
 * seed (e2e/seed.ts) guarantees offers; a prod smoke run asserts the real base.
 */
async function firstOfferId(page: import('@playwright/test').Page, baseURL: string | undefined): Promise<string> {
  const res = await page.request.get(`${baseURL}/api/jobs`);
  expect(res.ok(), 'the offers API must answer').toBeTruthy();
  const { jobs } = (await res.json()) as { jobs: { id: string }[] };
  expect(jobs.length, 'the board must hold at least one offer').toBeGreaterThan(0);
  return jobs[0].id;
}

test.describe('offer detail — the honest bridge (D18)', () => {
  test('renders the two distinct CTAs, never a false transmission promise', async ({ page, baseURL }) => {
    await page.goto(`/offre/${await firstOfferId(page, baseURL)}`);
    // The Catwalks matching CTA (leads to inscription with UTM).
    const matching = page.getByRole('link', { name: /matcher.*catwalks/i });
    await expect(matching).toBeVisible();
    await expect(matching).toHaveAttribute('href', /catwalks\.io\/inscription\?utm_source=fashion-atlas/);
    // The direct-employer CTA (honest: "voir l'offre", not "we transmit it").
    await expect(page.getByRole('link', { name: /voir l.?offre/i })).toBeVisible();
    // JSON-LD JobPosting is present for Google Jobs — a hard assertion now; the
    // old `.catch(() => {})` silently accepted a page with no structured data.
    await expect(page.locator('script[type="application/ld+json"]').first()).toBeAttached();
  });
});

test.describe('offer hygiene — HTTP status (D22/D23)', () => {
  test('a missing offer id returns 404', async ({ page }) => {
    const response = await page.goto('/offre/this-id-does-not-exist-xyz');
    expect(response?.status()).toBe(404);
  });

  test('an active offer returns 200', async ({ page, baseURL }) => {
    const response = await page.goto(`/offre/${await firstOfferId(page, baseURL)}`);
    expect(response?.status()).toBe(200);
  });

  test('an expired offer returns 410, noindex, and still renders the page', async ({ page }) => {
    // The fixed fixture id from e2e/seed.ts — this test needs the seeded base
    // (declared via E2E_SEEDED, set by CI); a prod smoke run has no known
    // closed id to probe, which is a documented environment limit, not a
    // failure being masked.
    test.skip(!process.env.E2E_SEEDED, 'needs the seeded fixtures base (E2E_SEEDED=1)');
    const response = await page.goto('/offre/e2e-closed-1');
    expect(response?.status()).toBe(410);
    expect(response?.headers()['x-robots-tag']).toContain('noindex');
    // D22 révisé: the REAL page renders behind the 410 — offer + expired notice.
    await expect(page.getByText(/expirée/i).first()).toBeVisible();
  });
});

test.describe('companies', () => {
  test('the directory lists Maisons and links to a profile', async ({ page }) => {
    await page.goto('/entreprises');
    const firstCard = page.getByRole('link').filter({ hasText: /emploi/i }).first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
  });
});

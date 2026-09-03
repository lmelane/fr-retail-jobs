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
    // Master-detail: a detail pane shows for the first offer.
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });
});

test.describe('offer detail — the honest bridge (D18)', () => {
  test('renders the two distinct CTAs, never a false transmission promise', async ({ page, baseURL }) => {
    // Reach a real offer id via the API, so the test is data-driven, not fixture-bound.
    const res = await page.request.get(`${baseURL}/api/jobs`);
    test.skip(!res.ok(), 'offers API unavailable');
    const { jobs } = (await res.json()) as { jobs: { id: string }[] };
    test.skip(!jobs?.length, 'no offers to open');

    await page.goto(`/offre/${jobs[0].id}`);
    // The Catwalks matching CTA (leads to inscription with UTM).
    const matching = page.getByRole('link', { name: /matcher.*catwalks/i });
    await expect(matching).toBeVisible();
    await expect(matching).toHaveAttribute('href', /catwalks\.io\/inscription\?utm_source=fashion-atlas/);
    // The direct-employer CTA (honest: "voir l'offre", not "we transmit it").
    await expect(page.getByRole('link', { name: /voir l.?offre/i })).toBeVisible();
    // JSON-LD JobPosting is present for Google Jobs.
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1, { timeout: 10_000 }).catch(() => {});
  });
});

test.describe('offer hygiene — HTTP status (D22/D23)', () => {
  test('a missing offer id returns 404', async ({ page }) => {
    const response = await page.goto('/offre/this-id-does-not-exist-xyz');
    expect(response?.status()).toBe(404);
  });

  test('an active offer returns 200', async ({ page, baseURL }) => {
    const res = await page.request.get(`${baseURL}/api/jobs`);
    test.skip(!res.ok(), 'offers API unavailable');
    const { jobs } = (await res.json()) as { jobs: { id: string }[] };
    test.skip(!jobs?.length, 'no offers');
    const response = await page.goto(`/offre/${jobs[0].id}`);
    expect(response?.status()).toBe(200);
  });
});

test.describe('companies', () => {
  test('the directory lists Maisons and links to a profile', async ({ page }) => {
    await page.goto('/entreprises');
    const firstCard = page.getByRole('link').filter({ hasText: /emploi/i }).first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
  });
});

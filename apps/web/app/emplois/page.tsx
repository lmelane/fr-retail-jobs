import { JobsView } from '@/components/jobs-view';
import { getJobs, parseFilters } from '@/lib/jobs';

/**
 * Rendered per request, not prerendered.
 *
 * With `revalidate`, Next prerendered this page at BUILD time — inside a Docker
 * builder that has no DATABASE_URL — so the demo fallback was baked into static
 * HTML and served forever, whatever the database held. The offers are read on
 * each request instead; caching belongs at the query layer, where it can see
 * whether the database actually answered.
 */
export const dynamic = 'force-dynamic';

/**
 * Step two of the funnel: results. Step one (`/`) is a clean, mostly-empty
 * landing — Indeed-style — with a single search pill; submitting it lands
 * here, on the real list.
 *
 * Search state lives in the URL, the way a jobboard's does: a filtered result
 * set can be linked, bookmarked and reloaded, and Back steps through searches
 * instead of leaving the page.
 *
 * Only page 1 is rendered here — for SEO and first paint. Page 2+ loads via
 * /api/jobs as the candidate scrolls (see JobsView), reusing this exact same
 * parseFilters so the infinite-scroll fetch and the server render can never
 * disagree on what a filter means.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  return <JobsView data={await getJobs(filters)} filters={filters} />;
}

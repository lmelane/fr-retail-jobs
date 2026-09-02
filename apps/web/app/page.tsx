import { JobsView } from '@/components/jobs-view';
import { getJobs, type JobFilters } from '@/lib/jobs';

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
 * Search state lives in the URL, the way a jobboard's does: a filtered result
 * set can be linked, bookmarked and reloaded, and Back steps through searches
 * instead of leaving the page.
 */
function parseFilters(params: Record<string, string | string[] | undefined>): JobFilters {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };

  const page = Number(one('page'));

  return {
    q: one('q'),
    city: one('ville'),
    contract: one('contrat'),
    sector: one('secteur'),
    maison: one('maison'),
    group: one('groupe'),
    source: one('source'),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  return <JobsView data={await getJobs(filters)} filters={filters} />;
}

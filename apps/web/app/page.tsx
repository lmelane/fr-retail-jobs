import { JobsView } from '@/components/jobs-view';
import { getJobs } from '@/lib/jobs';

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

export default async function Page() {
  return <JobsView data={await getJobs()} />;
}

import { CompaniesView } from '@/components/companies-view';
import { getCompanies, parseCompanyFilters } from '@/lib/companies';

export const dynamic = 'force-dynamic';

/**
 * Only page 1 is rendered here — for first paint. Page 2+ loads via
 * /api/companies as the visitor scrolls (see CompaniesView), reusing this exact
 * same parseCompanyFilters so the infinite-scroll fetch and the server render
 * can never disagree on what a filter means.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseCompanyFilters(await searchParams);
  return <CompaniesView data={await getCompanies(filters)} filters={filters} />;
}

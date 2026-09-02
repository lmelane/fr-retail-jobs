import { CompaniesView } from '@/components/companies-view';
import { getCompanies, type CompanyFilters } from '@/lib/companies';

export const dynamic = 'force-dynamic';

function parseFilters(params: Record<string, string | string[] | undefined>): CompanyFilters {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };
  const page = Number(one('page'));

  return {
    q: one('q'),
    sector: one('secteur'),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  return <CompaniesView data={await getCompanies(filters)} />;
}

import { LandingView } from '@/components/landing-view';
import { getJobs, landingStats } from '@/lib/jobs';
import { getCompanies } from '@/lib/companies';

/**
 * Home (design_2.md §5.1) — the editorial entry of the funnel. Everything is read
 * server-side from real data (never invented copy): headline counts, the sectors
 * with their offer counts, the Maisons that recruit most, and the latest offers.
 * A database blip degrades each block to empty rather than failing the page.
 */
export const dynamic = 'force-dynamic';

export default async function Page() {
  const [stats, latest, companies] = await Promise.all([
    landingStats().catch(() => ({ offers: 0, companies: 0, countries: 0, newCompaniesThisWeek: 0 })),
    getJobs({ page: 1 }).catch(() => null),
    getCompanies({ page: 1 }).catch(() => null),
  ]);

  // The home showcases MAISONS — not recruitment agencies or out-of-sector
  // enseignes. Filter (display only, no API change) on the sector CompanyRow
  // already carries, then take the top 6 by volume (getCompanies is already
  // sorted by jobCount desc).
  const EXCLUDED_FROM_HOME = new Set(['RECRUITER', 'OTHER', 'UNKNOWN']);
  const maisons = (companies?.companies ?? [])
    .filter((c) => !EXCLUDED_FROM_HOME.has(c.sector ?? 'UNKNOWN'))
    .slice(0, 6);

  return (
    <LandingView
      stats={stats}
      sectors={latest?.facets.sectors ?? []}
      maisons={maisons}
      latestOffers={(latest?.jobs ?? []).slice(0, 6)}
    />
  );
}

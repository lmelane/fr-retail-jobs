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
    landingStats().catch(() => ({ offers: 0, companies: 0, countries: 0 })),
    getJobs({ page: 1 }).catch(() => null),
    getCompanies({ page: 1 }).catch(() => null),
  ]);

  return (
    <LandingView
      stats={stats}
      sectors={latest?.facets.sectors ?? []}
      maisons={(companies?.companies ?? []).slice(0, 6)}
      latestOffers={(latest?.jobs ?? []).slice(0, 6)}
    />
  );
}

import { LandingView } from '@/components/landing-view';
import { landingStats } from '@/lib/jobs';

/**
 * Step one of the funnel: the landing page — the Catwalks hero's spirit
 * rewritten for the aggregator (decided 2026-09-02). A rotating word over the
 * families we cover leads the eye to a single search pill; the aggregator's
 * proof (real offer/Maison/country counts) sits below it. No job list here;
 * that is `/emplois`, reached by submitting the pill.
 *
 * The counts are read server-side so the headline states real numbers, never
 * invented copy; a database blip degrades to the pill alone.
 */
export const dynamic = 'force-dynamic';

export default async function Page() {
  const stats = await landingStats();
  return <LandingView stats={stats} />;
}

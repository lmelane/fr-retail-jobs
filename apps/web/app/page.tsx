import { LandingView } from '@/components/landing-view';

/**
 * Step one of the funnel: the landing page, Indeed-style — a clean, mostly-
 * empty page with a single centered search pill. No job list here; that is
 * `/emplois`, reached by submitting the pill (see LandingView).
 *
 * Unlike `/emplois`, this page needs no database read at all — matching
 * Indeed's own accueil, which renders before any search has happened.
 */
export default function Page() {
  return <LandingView />;
}

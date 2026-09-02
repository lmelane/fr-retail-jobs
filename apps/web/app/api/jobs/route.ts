import { NextRequest, NextResponse } from 'next/server';
import { DatabaseUnavailableError, getJobs, parseFilters } from '@/lib/jobs';

/**
 * Page 2+ of the offer list, for infinite scroll.
 *
 * Page 1 is server-rendered by app/page.tsx (SEO, first paint); this route
 * exists only so the candidate scrolling down never triggers a full page
 * reload. It reads the SAME URL keys as the server render — via the shared
 * parseFilters — so a search filtered by ville/secteur/contrat… continues
 * identically past page 1 instead of silently resetting.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const filters = parseFilters(params);

  try {
    const result = await getJobs(filters);
    return NextResponse.json(result);
  } catch (error) {
    // Same contract as the page: a database outage is a 503 with a clear
    // message, never a silently empty list passed off as "no results".
    if (error instanceof DatabaseUnavailableError) {
      return NextResponse.json(
        { error: 'La base de données des offres est indisponible.' },
        { status: 503 },
      );
    }
    throw error;
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getCompanies, parseCompanyFilters } from '@/lib/companies';
import { DatabaseUnavailableError } from '@/lib/jobs';
import { refuserSiCleInvalide } from '@/lib/cle-api';
import { randomUUID } from 'node:crypto';
import { paramsMultiples } from '@/lib/params-multiples';

/**
 * Page 2+ of the employer list, for infinite scroll.
 *
 * The companion to /api/jobs: the Entreprises list scrolls the same way the
 * offer list does, rather than one paging with buttons and the other by
 * scrolling. Page 1 is server-rendered by app/entreprises/page.tsx; this route
 * appends the rest as the visitor scrolls, reading the SAME URL keys via the
 * shared parseCompanyFilters.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const refus = refuserSiCleInvalide(request, randomUUID());
  if (refus) return refus;
  // D-426 : PAS `Object.fromEntries` — il ne garde qu'une valeur par clé et
  // annulerait le multi-valeurs avant même d'atteindre le parseur.
  const params = paramsMultiples(request.nextUrl.searchParams);
  const filters = parseCompanyFilters(params);

  try {
    const result = await getCompanies(filters);
    return NextResponse.json(result);
  } catch (error) {
    // Same contract as the page: a database outage is a 503 with a clear
    // message, never a silently empty list passed off as "no employers".
    if (error instanceof DatabaseUnavailableError) {
      return NextResponse.json(
        { error: 'La base de données des entreprises est indisponible.' },
        { status: 503 },
      );
    }
    throw error;
  }
}

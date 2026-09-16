import { NextRequest, NextResponse } from 'next/server';
import { getCompanies, parseCompanyFilters } from '@/lib/companies';
import { DatabaseUnavailableError } from '@/lib/jobs';
import { PerimetreRequisError } from '@/lib/perimetre';
import { CurseurInvalideError } from '@/lib/curseur';
import { refuserSiCleInvalide } from '@/lib/cle-api';
import { randomUUID } from 'node:crypto';
import { paramsMultiples } from '@/lib/params-multiples';

/**
 * The employer directory of a market, page by page (infinite scroll on the
 * site). It reads the SAME URL keys as the offer list via the shared
 * `parseCompanyFilters`, and is bounded by the same mandatory perimeter
 * (lot 6): without a valid `marche`, a 400 — never a world-wide directory.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  const refus = refuserSiCleInvalide(request, requestId);
  if (refus) return refus;
  // D-426 : PAS `Object.fromEntries` — il ne garde qu'une valeur par clé et
  // annulerait le multi-valeurs avant même d'atteindre le parseur.
  const filters = parseCompanyFilters(paramsMultiples(request.nextUrl.searchParams));

  try {
    const result = await getCompanies(filters);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PerimetreRequisError || error instanceof CurseurInvalideError) return NextResponse.json(error.corps(requestId), { status: 400 });
    // Same contract as the page: a database outage is a 503 with a clear
    // message, never a silently empty list passed off as "no employers".
    if (error instanceof DatabaseUnavailableError) {
      return NextResponse.json(
        { error: 'La base de données des entreprises est indisponible.', requestId },
        { status: 503 },
      );
    }
    throw error;
  }
}

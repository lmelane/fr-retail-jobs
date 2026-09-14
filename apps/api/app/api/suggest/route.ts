import { NextRequest, NextResponse } from 'next/server';
import { suggestCities, suggestTitles } from '@/lib/jobs';
import { suggestCompanies } from '@/lib/companies';

/**
 * Search-bar autocomplete, from our own data (decision D12): cities, job titles
 * and Maison names the board actually holds, so a suggestion always leads
 * somewhere real. `?type=city|title|company&q=<prefix>` returns up to 8 strings.
 *
 * A quiet endpoint: on any failure it returns an empty list rather than an
 * error — a broken autocomplete must never break the search box.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type');
  const q = request.nextUrl.searchParams.get('q') ?? '';

  try {
    const suggestions =
      type === 'city'
        ? await suggestCities(q)
        : type === 'company'
          ? await suggestCompanies(q)
          : await suggestTitles(q);
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}

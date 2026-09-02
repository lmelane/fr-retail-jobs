import { NextRequest, NextResponse } from 'next/server';
import { suggestCities, suggestTitles } from '@/lib/jobs';

/**
 * Search-bar autocomplete, from our own data (decision D12): cities and job
 * titles the board actually holds, so a suggestion always leads to results.
 * `?type=city|title&q=<prefix>` returns up to 8 strings.
 *
 * A quiet endpoint: on any failure it returns an empty list rather than an
 * error — a broken autocomplete must never break the search box.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type');
  const q = request.nextUrl.searchParams.get('q') ?? '';

  try {
    const suggestions = type === 'city' ? await suggestCities(q) : await suggestTitles(q);
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}

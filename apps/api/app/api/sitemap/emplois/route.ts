import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { refuserSiCleInvalide } from '@/lib/cle-api';
import { DatabaseUnavailableError } from '@/lib/jobs';
import { pageSitemapEmplois } from '@/lib/sitemap-emplois';

/**
 * `GET /api/sitemap/emplois?page=n` (lot 9) : une page du sitemap du catalogue.
 * Le contrat (stock éligible, `lastmod`, pagination) est dans
 * `lib/sitemap-emplois.ts` ; ici seulement la clé, le paramètre, le 404 d'une
 * page inexistante (jamais un sitemap vide) et l'indisponibilité de la base.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  const refus = refuserSiCleInvalide(request, requestId);
  if (refus) return refus;
  const entetes = { 'x-request-id': requestId, 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' };
  const brut = Number(request.nextUrl.searchParams.get('page') ?? '1');
  const page = Number.isSafeInteger(brut) && brut >= 1 ? brut : 1;
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    const resultat = await pageSitemapEmplois(page);
    if (page > resultat.pages) {
      return NextResponse.json({ error: 'PAGE_INEXISTANTE', page, pages: resultat.pages, requestId }, { status: 404, headers: { 'x-request-id': requestId } });
    }
    return NextResponse.json(resultat, { headers: entetes });
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) throw error;
    throw new DatabaseUnavailableError(error);
  }
}

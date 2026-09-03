import { NextResponse } from 'next/server';
import { siteUrl } from '@/lib/site-url';
import { sitemapOfferCount, SITEMAP_CHUNK_SIZE } from '@/lib/jobs';

/**
 * Index de sitemaps (S-03) : chunk 0 = pages statiques + Maisons, puis un
 * chunk de 5 000 offres. Chaque chunk est caché 1 h — l'index répond en
 * millisecondes quel que soit le volume, là où le monofichier 34 k timeoutait.
 */
// force-dynamic + Cache-Control explicite : avec `revalidate`, Next PRÉ-REND
// la route au BUILD — sur Railway la base interne y est injoignable et un 404
// prérendu a été figé et servi en prod (constaté: x-nextjs-prerender sur 404).
export const dynamic = 'force-dynamic';
const CACHE_HEADER = 'public, s-maxage=3600, stale-while-revalidate=600';

export async function GET() {
  const base = siteUrl();
  let offerChunks = 0;
  try {
    offerChunks = Math.ceil((await sitemapOfferCount()) / SITEMAP_CHUNK_SIZE);
  } catch {
    // Base injoignable : l'index sert au moins le chunk statique.
  }
  const lastmod = new Date().toISOString();
  const entries = [0, ...Array.from({ length: offerChunks }, (_, i) => i + 1)]
    .map((n) => `  <sitemap><loc>${base}/sitemaps/${n}</loc><lastmod>${lastmod}</lastmod></sitemap>`)
    .join('\n');

  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`,
    { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': CACHE_HEADER } },
  );
}

import { NextResponse } from 'next/server';
import { siteUrl } from '@/lib/site-url';
import { companySlug } from '@/lib/company-slug';
import { offerPath } from '@/lib/offer-url';
import { sitemapCompanies, sitemapOffersChunk } from '@/lib/jobs';

/**
 * Un chunk du sitemap (S-03) : /sitemaps/0 = pages statiques + Maisons ;
 * /sitemaps/N (N ≥ 1) = la tranche d'offres N, 5 000 URLs, paginée en base
 * par id croissant (stable entre régénérations). lastmod = updatedAt.
 */
export const revalidate = 3600;

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

function urlTag(loc: string, lastmod?: Date): string {
  const escaped = loc.replace(/&/g, '&amp;');
  return `  <url><loc>${escaped}</loc>${lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ''}</url>`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ chunk: string }> }) {
  const chunk = Number((await params).chunk);
  if (!Number.isInteger(chunk) || chunk < 0 || chunk > 500) {
    return new NextResponse('not found', { status: 404 });
  }
  const base = siteUrl();
  const urls: string[] = [];

  try {
    if (chunk === 0) {
      urls.push(urlTag(`${base}/`), urlTag(`${base}/emplois`), urlTag(`${base}/entreprises`));
      const seen = new Set<string>();
      for (const company of await sitemapCompanies()) {
        const slug = companySlug(company.name);
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        urls.push(urlTag(`${base}/entreprise/${slug}`, company.updatedAt));
      }
    } else {
      for (const offer of await sitemapOffersChunk(chunk - 1)) {
        urls.push(urlTag(`${base}${offerPath(offer)}`, offer.updatedAt));
      }
    }
  } catch {
    // Base injoignable : un urlset vide se re-génère dans l'heure — jamais un 500
    // qui ferait déréférencer le chunk.
  }

  return new NextResponse(`${XML_HEAD}${urls.join('\n')}\n</urlset>\n`, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
}

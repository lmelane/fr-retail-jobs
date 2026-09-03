import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site-url';

/**
 * robots.txt — lets search engines crawl the public pages and points them at the
 * sitemap. The `/api` routes are internal (JSON), never content to index.
 *
 * force-dynamic : la valeur de NEXT_PUBLIC_SITE_URL est lue à la requête — le
 * cache de build a servi l'ancien hôte Railway pendant des heures après la
 * bascule de domaine (constaté live, D30).
 */
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}

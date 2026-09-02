import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site-url';

/**
 * robots.txt — lets search engines crawl the public pages and points them at the
 * sitemap. The `/api` routes are internal (JSON), never content to index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}

/**
 * The site's public base URL, for absolute links in the sitemap, robots and
 * JSON-LD. Reads NEXT_PUBLIC_SITE_URL (set it to the real domain once it is
 * live) and falls back to the Railway URL. No trailing slash.
 */
export function siteUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL || 'https://catwalks-web-production.up.railway.app';
  return url.replace(/\/$/, '');
}

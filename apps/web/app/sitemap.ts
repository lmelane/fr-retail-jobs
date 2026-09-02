import type { MetadataRoute } from 'next';
import { sitemapData } from '@/lib/jobs';
import { companySlug } from '@/lib/company-slug';
import { siteUrl } from '@/lib/site-url';

/**
 * The sitemap — every indexable page, so search engines can discover the ~10k
 * offer pages and ~450 Maison pages that no on-site link exposes directly.
 * Without it these pages exist but stay invisible to Google, the single biggest
 * blocker to a job aggregator's SEO.
 *
 * Regenerated on demand (the catalogue changes constantly); a short cache keeps
 * it cheap. Well under the 50k-URL limit, so one file for now — split by type if
 * the catalogue outgrows it.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/emplois`, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${base}/entreprises`, changeFrequency: 'daily', priority: 0.8 },
  ];

  let dynamicPages: MetadataRoute.Sitemap = [];
  try {
    const { offers, companies } = await sitemapData();
    const seenCompany = new Set<string>();
    dynamicPages = [
      ...offers.map((o) => ({
        url: `${base}/offre/${o.id}`,
        lastModified: o.updatedAt,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      })),
      ...companies
        .map((c) => ({ slug: companySlug(c.name), updatedAt: c.updatedAt }))
        .filter((c) => c.slug && !seenCompany.has(c.slug) && (seenCompany.add(c.slug), true))
        .map((c) => ({
          url: `${base}/entreprise/${c.slug}`,
          lastModified: c.updatedAt,
          changeFrequency: 'daily' as const,
          priority: 0.6,
        })),
    ];
  } catch {
    // A database blip must not 500 the sitemap — serve the static pages so the
    // site stays crawlable, and the next revalidation picks the rest back up.
  }

  return [...staticPages, ...dynamicPages];
}

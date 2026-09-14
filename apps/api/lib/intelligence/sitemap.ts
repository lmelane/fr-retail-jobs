import { cached } from './cache';
import { byCity, byCompany, byCountry, byFunction, byGroup } from './facts';
import { MIN_SAMPLE } from './format';
import { intelPaths } from './paths';

/**
 * URLs Intelligence pour le chunk 0 du sitemap : les pages statiques, puis
 * les pays, villes, métiers, Maisons et groupes qui atteignent le seuil (les
 * pages sous seuil portent `noindex` : on ne les propose pas au crawl).
 */
export const sitemapIntelligence = cached('sitemap', async (): Promise<string[]> => {
  const urls = [intelPaths.home, intelPaths.market, intelPaths.geographies, intelPaths.functions, intelPaths.sectors, intelPaths.methodology];
  const [countries, cities, functions, companies, groups] = await Promise.all([byCountry(), byCity({}, 500), byFunction(), byCompany({}, 2000), byGroup({}, 200)]);
  for (const c of countries.rows) if (c.active >= MIN_SAMPLE) urls.push(intelPaths.country(c.code));
  for (const c of cities) if (c.active >= MIN_SAMPLE) urls.push(intelPaths.city(c.code, c.city));
  for (const f of functions) if (f.key && f.count >= MIN_SAMPLE) urls.push(intelPaths.fn(f.key));
  for (const c of companies) if (c.active >= MIN_SAMPLE) urls.push(intelPaths.company(c.name));
  for (const g of groups) if (g.count >= MIN_SAMPLE) urls.push(intelPaths.group(g.key));
  return [...new Set(urls)];
});

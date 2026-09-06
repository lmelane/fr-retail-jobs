import { closeBrowser } from '../lib/browser.js';

/**
 * `fetchAtsJobs('GENERIC_JSONLD', …)` est le chemin demandé, mais au moment de
 * la mesure `src/ats/index.ts` importe `./adapters/asosAlgolia.js`, supprimé
 * sur disque par une autre session (`git status` : `D`) : l'import du dispatch
 * plante. On tente le dispatch, sinon on appelle exactement la fonction que le
 * dispatch appelle pour ce type (`fetchGenericJsonLdJobs`).
 */
async function loadGeneric(): Promise<(config: Record<string, unknown>) => Promise<unknown>> {
  try {
    const { fetchAtsJobs } = await import('../ats/index.js');
    return (config) => fetchAtsJobs('GENERIC_JSONLD' as never, config as never);
  } catch (error) {
    console.error(`[mesure] dispatch inimportable (${(error as Error).message.slice(0, 80)}) → appel direct de fetchGenericJsonLdJobs`);
    const { fetchGenericJsonLdJobs } = await import('../ats/adapters/genericJsonLd.js');
    return fetchGenericJsonLdJobs;
  }
}
const fetchAtsJobs = async (_type: string, config: Record<string, unknown>) => (await loadGeneric())(config);

/**
 * PVH via le chemin de production : générique + amorçage WAF transparent dans
 * fetchWithRetry (aucune option d'adaptateur). Le temps d'amorçage est logué
 * par wafToken.ts (`[waf] … en N ms`).
 */
const t0 = Date.now();
const r: any = await fetchAtsJobs('GENERIC_JSONLD' as any, { sitemapUrl: 'https://careers.pvh.com/sitemap.xml', concurrency: 4 } as any);
const j: any[] = Array.isArray(r) ? r : r.jobs ?? [];
console.log(
  `pvh (générique + amorçage WAF): ${j.length} offres | ${j.filter((k) => k.location || k.city).length} lieu | ${j.filter((k) => (k.description ?? '').length > 200).length} desc | ${j.filter((k) => k.postedAt).length} date | ${Math.round((Date.now() - t0) / 1000)}s`,
);
if (j[0]) console.log(`   ex: ${String(j[0].title).slice(0, 60)} @ ${j[0].location ?? j[0].city ?? '-'} — ${j[0].url}`);
const countries = new Map<string, number>();
for (const k of j) countries.set(k.country ?? '-', (countries.get(k.country ?? '-') ?? 0) + 1);
console.log(`   pays: ${[...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, n]) => `${c}:${n}`).join(' ')}`);
await closeBrowser();

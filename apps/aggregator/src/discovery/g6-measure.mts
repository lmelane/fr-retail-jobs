/**
 * g6 — mesure réelle d'une source avec la config de la table Source (lecture
 * seule, aucune écriture). `npx tsx src/discovery/g6-measure.mts <source> [sample]`
 *
 * Ligne : offres | lieu | desc>200 | date | temps, plus un exemple.
 */
import { fetchAtsJobs } from '../ats/index.js';
import { fetchSitemapUrls, fetchJobFromPage } from '../connectors/generic/jsonLdSitemap.js';
import type { NormalizedJob } from '../types.js';
import pLimit from 'p-limit';

const CONFIGS: Record<string, { type: string; config: Record<string, unknown> }> = {
  hermes: { type: 'WTTJ', config: { slug: 'hermes' } },
  diptyque: { type: 'WTTJ', config: { slug: 'diptyque-paris' } },
  jako: { type: 'PERSONIO', config: { host: 'jako.jobs.personio.de', subdomain: 'jako' } },
  'sephora-france': { type: 'SUCCESSFACTORS', config: { origin: 'https://jobs.sephora.com/France' } },
  'l-oreal-professionnel': {
    type: 'AVATURE',
    config: { origin: 'https://careers.loreal.com', listingUrl: 'https://careers.loreal.com/en_US/jobs/SearchJobs/?jobOffset=0', maxPages: Number(process.env.AV_MAX_PAGES ?? 120) },
  },
  'l-oreal-portail': { type: 'AVATURE', config: { origin: 'https://careers.loreal.com', lists: ['fr_FR/jobs/SearchJobs'] } },
  adidas: { type: 'SUCCESSFACTORS', config: { origin: 'https://jobs.adidas-group.com' } },
  crocs: { type: 'SUCCESSFACTORS', config: { origin: 'https://careers.crocs.com' } },
  avolta: { type: 'SUCCESSFACTORS', config: { origin: 'https://careers.avoltaworld.com' } },
};

const SITEMAPS: Record<string, { url: string; pattern: RegExp }> = {
  loreal: { url: 'https://careers.loreal.com/fr_FR/jobs/sitemap.xml', pattern: /\/jobs\/JobDetail/ },
  kering: { url: 'https://www.kering.com/fr/sitemap.xml', pattern: /\/offres-d-emploi\/[^/]+\/[^/]+/ },
};

const name = process.argv[2];
const sample = Number(process.argv[3] ?? 0);
const t0 = Date.now();

function report(label: string, jobs: NormalizedJob[], extra = '') {
  const withPlace = jobs.filter((j) => j.location || j.city).length;
  const withDesc = jobs.filter((j) => (j.description ?? '').length > 200).length;
  const withDate = jobs.filter((j) => j.postedAt).length;
  const flat = jobs.filter((j) => (j.description ?? '').length > 1500 && !j.description!.includes('\n')).length;
  const seconds = Math.round((Date.now() - t0) / 1000);
  console.log(
    `${label}: ${jobs.length} offres | ${withPlace} lieu | ${withDesc} desc>200 | ${withDate} date | ${seconds}s` +
      ` | pavés>1500 sans saut: ${flat}${extra}`,
  );
  const ex = jobs.find((j) => (j.description ?? '').length > 200) ?? jobs[0];
  if (ex) {
    console.log(`   ex: ${String(ex.title).slice(0, 60)} @ ${ex.location ?? ex.city ?? '-'} | desc ${ex.description?.length ?? 0} car., ${(ex.description?.match(/\n/g) ?? []).length} sauts`);
    console.log(`   ${JSON.stringify((ex.description ?? '').slice(0, 220))}`);
  }
}

if (CONFIGS[name]) {
  const { type, config } = CONFIGS[name];
  const r = (await fetchAtsJobs(type as never, config as never)) as NormalizedJob[] | { jobs: NormalizedJob[]; declaredTotal?: number; truncated?: boolean };
  const jobs = Array.isArray(r) ? r : r.jobs;
  const extra = Array.isArray(r) ? '' : ` | declaredTotal ${r.declaredTotal ?? '-'} truncated ${r.truncated ?? '-'}`;
  report(name, jobs, extra);
} else if (SITEMAPS[name]) {
  const { url, pattern } = SITEMAPS[name];
  const all = [...new Set(await fetchSitemapUrls(url))].filter((u) => pattern.test(u));
  const urls = sample > 0 ? all.slice(0, sample) : all;
  console.log(`${name}: ${all.length} URLs d'offres dans le sitemap, ${urls.length} lues`);
  const limit = pLimit(4);
  let errors = 0;
  const jobs = (
    await Promise.all(
      urls.map((u) =>
        limit(async () => {
          try {
            return await fetchJobFromPage(u);
          } catch (e) {
            errors++;
            if (errors <= 3) console.log('   erreur', u.slice(-60), (e as Error).message.slice(0, 60));
            return null;
          }
        }),
      ),
    )
  ).filter((j): j is NormalizedJob => !!j);
  report(`${name} (sitemap, échantillon ${urls.length})`, jobs, ` | erreurs ${errors}`);
} else {
  console.log('source inconnue', name, Object.keys({ ...CONFIGS, ...SITEMAPS }));
}

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import pLimit from 'p-limit';
import { fetchWithRetry } from '../lib/http.js';

/**
 * Audit a4 (informations des offres) — lecture seule, aucune base.
 *
 * Pour chaque offre de l'échantillon (JSON produit par a4-sample.sql) :
 *  - la page publique du site : https://modecareers.com/offre/<id>
 *  - la page d'origine : Job.url (telle que stockée)
 *  - l'API détail de l'ATS quand on la connaît (Workday cxs, SmartRecruiters,
 *    Eightfold), pour lire ce que la Maison publie sans passer par le rendu JS.
 * Tout est enregistré dans le scratchpad ; rien n'est écrit dans le dépôt.
 *
 * Usage : npx tsx src/discovery/a4-fetch.mts <sample.json> <outDir>
 */
const [sampleFile, outDir] = process.argv.slice(2);
if (!sampleFile || !outDir) throw new Error('usage: a4-fetch.mts <sample.json> <outDir>');
mkdirSync(outDir, { recursive: true });

type Row = { id: string; sourceKey: string; url: string; source_url: string; title: string };
const rows: Row[] = JSON.parse(readFileSync(sampleFile, 'utf8'));

type Grab = { status?: number; finalUrl?: string; bytes?: number; jsonld?: unknown[]; title?: string; error?: string; file?: string };

const SITE = process.env.SITE_ORIGIN ?? 'https://modecareers.com';

function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      out.push({ __unparsable: m[1].slice(0, 200) });
    }
  }
  return out;
}

function pageTitle(html: string): string | undefined {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
}

async function grab(url: string, file: string, init: RequestInit = {}): Promise<Grab> {
  try {
    const response = await fetchWithRetry(url, init, 2);
    const text = await response.text();
    writeFileSync(file, text);
    return {
      status: response.status,
      finalUrl: response.url || undefined,
      bytes: text.length,
      jsonld: extractJsonLd(text),
      title: pageTitle(text),
      file,
    };
  } catch (error) {
    return { error: (error as Error).message.slice(0, 200) };
  }
}

/** L'API détail de l'ATS, déduite de l'URL d'origine — ce que l'adaptateur lit. */
function atsDetailRequests(url: string): Array<{ name: string; url: string; init?: RequestInit }> {
  const u = new URL(url);
  const reqs: Array<{ name: string; url: string; init?: RequestInit }> = [];
  const wd = u.hostname.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i);
  if (wd) {
    // https://{tenant}.wdN.myworkdayjobs.com/{site}/job/{loc}/{slug}_{id}
    const [, site, ...rest] = u.pathname.split('/');
    const path = '/' + rest.join('/');
    const base = `${u.origin}/wday/cxs/${wd[1]}/${site}`;
    reqs.push({ name: 'workday-cxs-en', url: `${base}${path}`, init: { headers: { 'accept-language': 'en-US,en;q=0.9' } } });
    reqs.push({ name: 'workday-cxs-fr', url: `${base}${path}`, init: { headers: { 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7' } } });
  }
  const sr = u.hostname === 'jobs.smartrecruiters.com' && u.pathname.match(/^\/([^/]+)\/(\d+)/);
  if (sr) reqs.push({ name: 'smartrecruiters-api', url: `https://api.smartrecruiters.com/v1/companies/${sr[1]}/postings/${sr[2]}` });
  const ef = u.pathname.match(/\/careers\/job\/(\d+)/);
  if (ef && /eightfold\.ai|elcompanies\.com|kering\.com/.test(u.hostname)) {
    reqs.push({ name: 'eightfold-api', url: `${u.origin}/api/apply/v2/jobs/${ef[1]}?domain=${u.hostname.replace(/^careers\./, '').replace(/^.*\.eightfold\.ai$/, 'elcompanies.com')}` });
  }
  const tt = u.pathname.match(/^\/jobs\/(\d+)/);
  if (tt && /teamtailor\.com$|careers\.monicavinader\.com/.test(u.hostname)) {
    reqs.push({ name: 'teamtailor-json', url: `${u.origin}/jobs/${tt[1]}.json` });
  }
  const icims = u.hostname.endsWith('.icims.com') && u.pathname.match(/^\/jobs\/(\d+)\/login/);
  if (icims) reqs.push({ name: 'icims-job', url: `${u.origin}/jobs/${icims[1]}/job?in_iframe=1` });
  return reqs;
}

const limit = pLimit(4);
const results: Record<string, unknown>[] = [];

await Promise.all(
  rows.map((row, index) =>
    limit(async () => {
      const tag = `${String(index + 1).padStart(2, '0')}-${row.sourceKey}`;
      const site = await grab(`${SITE}/offre/${row.id}`, `${outDir}/${tag}.site.html`);
      const src = await grab(row.url, `${outDir}/${tag}.source.html`);
      const extra: Record<string, Grab> = {};
      for (const req of atsDetailRequests(row.url)) {
        extra[req.name] = await grab(req.url, `${outDir}/${tag}.${req.name}.json`, req.init);
      }
      const summary = { index: index + 1, id: row.id, sourceKey: row.sourceKey, url: row.url, site, source: src, extra };
      results.push(summary);
      console.log(
        `${tag}: site=${site.status ?? site.error} jsonld=${site.jsonld?.length ?? 0} | source=${src.status ?? src.error} jsonld=${src.jsonld?.length ?? 0} final=${src.finalUrl?.slice(0, 90) ?? ''}` +
          Object.entries(extra).map(([k, v]) => ` | ${k}=${v.status ?? v.error}`).join(''),
      );
    }),
  ),
);

results.sort((a, b) => (a.index as number) - (b.index as number));
writeFileSync(`${outDir}/summary.json`, JSON.stringify(results, null, 1));
console.log(`\n${results.length} offres, résumé dans ${outDir}/summary.json`);

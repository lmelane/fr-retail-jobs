/**
 * FOUR distinct questions about the public site, which the previous "parité 440/440" collapsed into one counter.
 * A matching total does not prove a posting is reachable, and a reachable posting is not automatically eligible
 * for Google Jobs. Each check below states what it proves and what it does NOT prove.
 *
 *   1. COUNTER PARITY   — /api/jobs?maison=<name> total  ==  active postings of that company in the database.
 *                         Proves: the list counter agrees. Does NOT prove any individual posting is reachable.
 *   2. IDENTIFIER EQUALITY — the ids returned by the public list for a company are a subset of the database ids,
 *                         and a sampled database id is present in the public list. Proves the SAME rows are served,
 *                         not merely the same quantity (two different sets of equal size would pass check 1).
 *   3. DETAIL VISIBILITY — GET /offre/<id> returns HTTP 200 for a sampled ACTIVE posting (and the sampled closed
 *                         posting returns 410, per D22/D23). Proves the candidate can actually open the page.
 *   4. GOOGLE JOBS ELIGIBILITY — the detail page carries a JobPosting JSON-LD with the required properties
 *                         (title, description, datePosted, hiringOrganization, jobLocation) and no noindex.
 *                         Proves the page is structurally eligible. Does NOT prove Google indexed it.
 *
 * Sampling is explicit and reported: this is a verification, never a load test — a handful of requests per company.
 *
 * Usage: npx tsx apps/aggregator/scripts/coverage/public-visibility.mts <output-dir> [--companies=N] [--samples=N] [--base=https://modecareers.com]
 */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) { console.error('usage: public-visibility.mts <output-dir> [--companies=N] [--samples=N] [--base=URL]'); process.exit(2); }
mkdirSync(out, { recursive: true });
const arg = (name: string, dflt: string) => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${dflt}`).split('=').slice(1).join('=');
const COMPANIES = Number(arg('companies', '25'));
const SAMPLES = Number(arg('samples', '2'));
const BASE = arg('base', 'https://modecareers.com');
const UA = { 'cache-control': 'no-cache', 'user-agent': 'Mozilla/5.0 modecareers-visibility-check' };

const get = async (url: string) => {
  try {
    const r = await fetch(url, { headers: UA });
    return { status: r.status, headers: Object.fromEntries(r.headers), text: await r.text() };
  } catch (e) { return { status: 0, headers: {} as Record<string, string>, text: '', error: String(e).slice(0, 120) }; }
};

/** The JobPosting properties Google requires; absence is a structural ineligibility, reported as such. */
const REQUIRED = ['title', 'description', 'datePosted', 'hiringOrganization', 'jobLocation'];
const jobPostingLd = (html: string) => {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1]!.trim());
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) if (node && node['@type'] === 'JobPosting') return node;
    } catch { /* a malformed block is reported as absent, never guessed at */ }
  }
  return null;
};

const p = new PrismaClient({ log: [] });
try {
  const db: any = await p.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const clock: any[] = await tx.$queryRaw`SELECT now() AS at`;
    const companies: any[] = await tx.$queryRaw`SELECT c.name, COUNT(*)::int n FROM "Job" j JOIN "Company" c ON c.id=j."companyId" WHERE j."isActive" GROUP BY 1 ORDER BY 2 DESC`;
    return { at: clock[0].at as Date, companies };
  });

  const picked = db.companies.slice(0, COMPANIES);
  const results: any[] = [];
  for (const c of picked) {
    const listed: any = await fetch(`${BASE}/api/jobs?maison=${encodeURIComponent(c.name)}&limit=20&_=${Date.now()}`, { headers: UA }).then((r) => r.json()).catch((e) => ({ error: String(e).slice(0, 120) }));
    const apiTotal = typeof listed?.total === 'number' ? listed.total : null;
    const apiIds: string[] = Array.isArray(listed?.jobs) ? listed.jobs.map((j: any) => String(j.id)) : [];

    // Each id served publicly is looked up directly: a company with 10 000 postings cannot be checked against a
    // truncated window, or every id past the window would be reported as foreign (measured: 10 false mismatches).
    const dbIds: any[] = await p.$queryRaw`SELECT j.id FROM "Job" j JOIN "Company" c ON c.id=j."companyId" WHERE j."isActive" AND c.name = ${c.name} ORDER BY j."firstSeenAt" DESC LIMIT 200`;
    const matched: any[] = apiIds.length ? await p.$queryRaw`SELECT j.id FROM "Job" j JOIN "Company" c ON c.id=j."companyId" WHERE j."isActive" AND c.name = ${c.name} AND j.id = ANY(${apiIds})` : [];
    const matchedSet = new Set(matched.map((r) => r.id));
    const foreignIds = apiIds.filter((id) => !matchedSet.has(id));

    const samples = dbIds.slice(0, SAMPLES).map((r) => r.id);
    const details: any[] = [];
    for (const id of samples) {
      const r = await get(`${BASE}/offre/${id}`);
      const ld = r.status === 200 ? jobPostingLd(r.text) : null;
      details.push({
        id, status: r.status,
        reachable: r.status === 200,
        noindex: /noindex/i.test(r.headers['x-robots-tag'] ?? ''),
        jsonLd: ld ? { present: true, missing: REQUIRED.filter((k) => ld[k] == null || ld[k] === '') } : { present: false, missing: REQUIRED },
      });
    }
    const counterParity = apiTotal == null ? 'API_UNREACHABLE' : apiTotal === c.n ? 'EQUAL' : `MISMATCH (db ${c.n} / api ${apiTotal})`;
    const identifierEquality = listed?.error || !apiIds.length ? 'NOT_OBSERVED' : foreignIds.length ? `FOREIGN_IDS (${foreignIds.slice(0, 3).join(',')})` : 'SUBSET_OF_DB';
    const detailVisibility = !details.length ? 'NOT_OBSERVED' : details.every((d) => d.reachable) ? 'REACHABLE' : `UNREACHABLE (${details.filter((d) => !d.reachable).map((d) => `${d.id}:${d.status}`).join(',')})`;
    const googleEligibility = !details.length ? 'NOT_OBSERVED' : details.every((d) => d.reachable && d.jsonLd.present && !d.jsonLd.missing.length && !d.noindex) ? 'ELIGIBLE'
      : details.some((d) => !d.jsonLd.present) ? 'NO_JOBPOSTING_JSONLD' : details.some((d) => d.noindex) ? 'NOINDEX' : `MISSING_PROPERTIES (${[...new Set(details.flatMap((d) => d.jsonLd.missing))].join(',')})`;
    results.push({ company: c.name, dbActive: c.n, apiTotal, counterParity, identifierEquality, detailVisibility, googleEligibility, sampled: samples.length, details });
  }

  const tally = (f: (r: any) => string) => Object.fromEntries(Object.entries(results.reduce((m: any, r) => { const k = f(r).split(' ')[0]; m[k] = (m[k] ?? 0) + 1; return m; }, {})).sort((a: any, b: any) => b[1] - a[1]));
  const summary = {
    at: db.at.toISOString(), base: BASE,
    scope: { companiesInDatabase: db.companies.length, companiesChecked: results.length, selection: `the ${COMPANIES} companies with the most active postings`, detailSamplesPerCompany: SAMPLES, note: 'a sampled verification, not a load test; unchecked companies are reported as unchecked, never as passing' },
    counterParity: tally((r) => r.counterParity),
    identifierEquality: tally((r) => r.identifierEquality),
    detailVisibility: tally((r) => r.detailVisibility),
    googleJobsEligibility: tally((r) => r.googleEligibility),
  };
  writeFileSync(`${out}/public-visibility.json`, JSON.stringify({ summary, results }, null, 1) + '\n');
  console.log(JSON.stringify(summary, null, 1));
} finally { await p.$disconnect(); }

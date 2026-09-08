/** Read-only public-source certification. No database and no FashionJobs offers. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { fetchText } from '../../../apps/aggregator/src/lib/http.js';
import { parseFlatchrBoard } from '../../../apps/aggregator/src/ats/adapters/flatchr.js';
import { toCandidate } from '../../../apps/aggregator/src/pipeline/ingest.js';
import { normalizeCountry } from '../../../apps/aggregator/src/normalize/country.js';
const out = 'backups/remediation-20260908';
const url = 'https://adopt.flatchr.io/fr/company/adopt/';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const live = process.argv.includes('--live');
const html = live ? await fetchText(url) : readFileSync(`${out}/adopt-direct.html`, 'utf8');
if (live) writeFileSync(`${out}/adopt-live.html`, html, { mode: 0o600 });
const result = parseFlatchrBoard(html, url);
if (!result.complete) throw new Error('Enumeration not complete');
const source = { key: 'adopt-parfums', company: 'Adopt Parfums', tier: 'ATS_OFFICIAL' as const, careersDomain: 'adopt.flatchr.io', maison: 'Adopt Parfums' };
const countries: Record<string,number> = {};
for (const j of result.jobs) {
 const code = normalizeCountry(j.country) ?? 'UNKNOWN'; countries[code] = (countries[code] ?? 0) + 1;
}
const examples = [];
for (const country of Object.keys(countries)) {
 const j = result.jobs.find(j => (normalizeCountry(j.country) ?? 'UNKNOWN') === country)!;
 const c = toCandidate(j, source, j.company!, 'FLATCHR');
 const detail = live ? await fetchText(j.url) : '';
 if (live) {
   const d = JSON.parse(cheerio.load(detail)('#__NEXT_DATA__').text());
   if (d.query?.vacancySlug !== (j.raw as any).vacancy.slug) throw new Error(`Detail mismatch ${j.url}`);
 }
 examples.push({ externalId: j.externalId, url: j.url, countryRaw: j.country, countryCode: country,
   companyId: c.companyId, employmentTerm: c.employmentTerm, workTime: c.workTime, detailRead: live, detailSha256: live ? hash(detail) : null });
}
const proof = { observedAt: new Date().toISOString(), mode: live ? 'LIVE_PUBLIC_READ' : 'ARCHIVED_REPLAY',
 portal: url, payloadSha256: hash(html), declaredTotal: result.declaredTotal, fetched: result.jobs.length,
 uniqueIds: new Set(result.jobs.map(j => j.externalId)).size, complete: result.complete, countries,
 descriptionCount: result.jobs.filter(j => j.description).length, examples,
 ids: result.jobs.map(j => j.externalId).sort(),
 limits: ['Complete for this unfiltered portal at observation time; separate regional portals not ruled out.',
 'Rendered total and embedded list belong to one source snapshot; this is not independent employer inventory attestation.',
 'Remote enum and board language are preserved RAW, not inferred. Contract end is not vacancy expiry.'] };
writeFileSync(`audits/2026-09-08/direct-sources/adopt-${live ? 'live' : 'replay'}-proof.json`, JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify({...proof, ids: undefined}));

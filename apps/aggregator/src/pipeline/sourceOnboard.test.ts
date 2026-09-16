import '../test/setup-integration.js';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STORAGE_ENV } from '../retention/objectStore.js';

const db = new PrismaClient();
const key = `onboard-cli-${randomUUID()}`;
const directory = mkdtempSync(join(tmpdir(), 'catwalks-source-cli-'));
const file = (name: string) => join(directory, name);
const json = (name: string, value: unknown) => { writeFileSync(file(name), JSON.stringify(value), { mode: 0o600 }); return file(name); };
const candidate = { key, maison: 'Synthetic CLI Maison', kind: 'ashby', config: { board: key }, careersDomain: 'jobs.ashbyhq.com', tier: 'ATS_OFFICIAL' };
const input = json('candidate.json', candidate);
const calls = file('transport.jsonl');
const preload = file('transport.mjs');
const env = { ...process.env };
for (const name of Object.values(STORAGE_ENV)) delete env[name];
// Exercise the real HTTP/capture/adapter path with a bounded synthetic response.
// No fallback to the network is possible in any child process.
writeFileSync(preload, `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (input) => {
 const url = String(input instanceof Request ? input.url : input);
 appendFileSync(${JSON.stringify(calls)}, JSON.stringify(url) + '\\n');
 if (process.env.SOURCE_CLI_TEST_TRANSPORT === 'robots' && url === 'https://api.ashbyhq.com/robots.txt') return new Response('User-agent: *\\nDisallow: /\\n', {headers:{'content-type':'text/plain'}});
 if (process.env.SOURCE_CLI_TEST_TRANSPORT === 'evidence' && url === 'https://synthetic-maison.example/careers') return new Response(${JSON.stringify(`<a href="https://jobs.ashbyhq.com/${key}">Observed synthetic official-page link</a>`)}, {headers:{'content-type':'text/html; charset=utf-8'}});
 if (process.env.SOURCE_CLI_TEST_TRANSPORT !== 'native' || url !== ${JSON.stringify(`https://api.ashbyhq.com/posting-api/job-board/${key}?includeCompensation=true`)}) throw new Error('Unexpected network access in source CLI test');
 return new Response(JSON.stringify({apiVersion:'1',jobs:[{id:'native-1',title:'Client Advisor',isListed:process.env.SOURCE_CLI_TEST_HIDDEN !== '1',descriptionPlain:'Synthetic native responsibilities',jobUrl:${JSON.stringify(`https://jobs.ashbyhq.com/${key}/native-1`)},address:{postalAddress:{addressCountry:'FR',addressLocality:'Paris'}}}]}), {headers:{'content-type':'application/json'}});
};`, { mode: 0o600 });

function cli(args: string[], options: { native?: boolean; hidden?: boolean; evidence?: boolean; robots?: boolean; failure?: RegExp } = {}) {
 const out = file(`output-${randomUUID()}.json`);
 const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', preload, 'scripts/ops/source-onboard.mts', ...args, `--out=${out}`], {
   env: { ...env, SOURCE_CLI_TEST_TRANSPORT: options.robots ? 'robots' : options.evidence ? 'evidence' : options.native ? 'native' : 'offline', SOURCE_CLI_TEST_HIDDEN: options.hidden ? '1' : '0' }, encoding: 'utf8', timeout: 45_000,
 });
 expect(result.error).toBeUndefined();
 if (options.failure) {
   expect(result.status, result.stderr + result.stdout).not.toBe(0);
   expect(result.stderr + result.stdout).toMatch(options.failure);
   return null;
 }
 expect(result.status, result.stderr + result.stdout).toBe(0);
 expect(statSync(out).mode & 0o777).toBe(0o600);
 return JSON.parse(readFileSync(out, 'utf8'));
}
const source = () => db.source.findUniqueOrThrow({ where: { key } });
const wipe = async () => {
 await db.$executeRaw`TRUNCATE "SourceIngestionAdmission", "SourceIdentityReview"`;
 await db.source.deleteMany({ where: { key } });
};
beforeAll(wipe);
afterAll(async () => { await wipe(); await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

it('executes the source CLI with independent previews, native evidence, exact promotion and safe retries', async () => {
 const revisions = await db.sourceRevision.count();
 expect(cli(['register', input])).toMatchObject({ mode: 'PREVIEW', created: false, willCreate: true, status: null });
 expect(await db.source.count({ where: { key } })).toBe(0);
 expect(await db.sourceRevision.count()).toBe(revisions);
 expect(cli(['register', input, '--apply'])).toMatchObject({ mode: 'APPLY', created: true, status: 'DRAFT' });
 const draft = await source();
 expect(cli(['register', input, '--apply'])).toMatchObject({ created: false, willCreate: false, sourceRevisionId: draft.currentRevisionId });
 expect(await source()).toEqual(draft);
 const profile = cli(['profile', key]);
 expect(profile).toMatchObject({ sourceKey: key, sourceRevisionId: draft.currentRevisionId, tenantKey: `ashby:${key}` });
 expect(profile).not.toHaveProperty('config');
 const initial = cli(['status', key]);
 expect(initial).toMatchObject({ status: 'DRAFT', identity: { passed: false, code: 'REVIEW_MISSING' }, native: { passed: false, code: 'VALIDATION_MISSING' }, access: { passed: false, revisionBound: true }, promotionGatesPass: false });

 const page = cli(['evidence', key, '--purpose=identity', `--revision=${draft.currentRevisionId}`,
   '--url=https://synthetic-maison.example/careers', '--apply'], { evidence: true });
 expect(page).toMatchObject({ sourceRevisionId: draft.currentRevisionId, purpose: 'SOURCE_IDENTITY', responseCount: 1, lastStatus: 200 });
 const review = { sourceKey: key, sourceRevisionId: draft.currentRevisionId, captureBatchId: page.captureBatchId,
   verdict: 'VERIFIED', officialDomain: 'synthetic-maison.example',
   statement: 'Synthetic test only: this fixture is not an actual reviewed employer.',
   reviewer: 'isolated-cli-integration-test', checkedAt: new Date().toISOString(), portalScope: 'SINGLE_BRAND' };
 const record = json('review.json', review);
 expect(cli(['identity', record])).toMatchObject({ written: 0, isLatestDecision: null });
 expect(await db.sourceIdentityReview.count({ where: { sourceKey: key } })).toBe(0);
 const decision = cli(['identity', record, '--apply']);
 expect(decision).toMatchObject({ written: 1, isLatestDecision: true });
 expect(cli(['identity', record, '--apply'])).toMatchObject({ reviewId: decision.reviewId, written: 0, isLatestDecision: true });
 expect(await source()).toEqual(draft);

 // Qualification requires real captured bytes, with no caller-supplied volume.
 const validation = cli(['collect', key, '--apply', '--deadline-ms=15000'], { native: true });
 expect(validation).toMatchObject({ verdict: 'VALIDATED', sourceRevisionId: draft.currentRevisionId });
 let transports = readFileSync(calls, 'utf8');
 expect(transports.trim().split('\n')).toHaveLength(2);
 expect(cli(['validate', validation.captureBatchId, '--apply'])).toMatchObject({ verdict: 'VALIDATED', captureBatchId: validation.captureBatchId });
 expect(readFileSync(calls, 'utf8')).toBe(transports);
 expect(cli(['relation', key, `--capture=${page.captureBatchId}`, '--official-domain=synthetic-maison.example']))
   .toMatchObject({ verdict: 'LINK_MATCHED', identityApproved: false });
 cli(['relation', key, `--capture=${page.captureBatchId}`, '--official-domain=other.example'], { failure: /PAGE_OUTSIDE_REVIEWED_DOMAIN/ });
 transports = readFileSync(calls, 'utf8');
 expect(transports.trim().split('\n')).toHaveLength(2);
 expect(await source()).toEqual(draft);
 expect(await db.jobSource.count({ where: { sourceKey: key } })).toBe(0);
 expect(cli(['status', key])).toMatchObject({ identity: { passed: true }, native: { passed: true }, access: { passed: false }, promotionGatesPass: false,
   latestCaptureAttempt: { id: validation.captureBatchId, outcome: { status: 'EXTRACTED', extractedCount: 1 } } });
 cli(['promote', key, `--revision=${draft.currentRevisionId}`, '--apply'], { failure: /ACCESS_MISSING/ });
 expect(await source()).toEqual(draft);

 const robots = cli(['evidence', key, '--purpose=access', `--revision=${draft.currentRevisionId}`,
   '--url=https://api.ashbyhq.com/robots.txt', '--apply'], { robots: true });
 const accessDocument = json('access.json', { sourceKey: key, sourceRevisionId: draft.currentRevisionId,
   captureBatchId: validation.captureBatchId, verdict: 'ALLOWED', robotsCaptureIds: [robots.captureBatchId],
   scopes: [{ origin: 'https://api.ashbyhq.com', path: { kind: 'EXACT', value: `/posting-api/job-board/${key}` },
     methods: ['GET'], query: { fixed: { includeCompensation: 'true' }, variable: [] }, surface: 'PUBLIC_ATS_JOB_API' }],
   reviewer: 'isolated-cli-integration-test', statement: 'Synthetic native public board; the existing owner sector authorization applies.', checkedAt: new Date().toISOString() });
 expect(cli(['access', accessDocument])).toMatchObject({ written: 0, observations: { DISALLOWED: 1 } });
 const access = cli(['access', accessDocument, '--apply']);
 expect(access).toMatchObject({ written: 1, isLatestDecision: true, observations: { DISALLOWED: 1 } });
 expect(cli(['access', accessDocument, '--apply'])).toMatchObject({ written: 0, decisionId: access.decisionId });
 expect(cli(['status', key])).toMatchObject({ access: { passed: true, revisionBound: true }, promotionGatesPass: true });
 cli(['promote', key, '--revision=wrong', '--apply'], { failure: /REVISION_MISMATCH/ });
 expect((await source()).status).toBe('DRAFT');
 expect(cli(['promote', key, `--revision=${draft.currentRevisionId}`, '--apply'])).toEqual({ key, from: 'DRAFT', to: 'ACTIVE' });
 const active = await source();
 expect(cli(['promote', key, `--revision=${draft.currentRevisionId}`, '--apply'])).toEqual({ key, from: 'ACTIVE', to: 'ACTIVE' });
 expect(await source()).toEqual(active);

 const contradiction = json('contradiction.json', { ...review, verdict: 'CONTRADICTED', portalScope: null });
 expect(cli(['identity', contradiction, '--apply'])).toMatchObject({ written: 1, isLatestDecision: true });
 expect(cli(['identity', record, '--apply'])).toMatchObject({ written: 0, isLatestDecision: false });
 expect(cli(['status', key])).toMatchObject({ identity: { passed: false }, promotionGatesPass: false });
 cli(['promote', key, `--revision=${draft.currentRevisionId}`, '--apply'], { failure: /REVIEW_MISSING/ });
 expect(await source()).toEqual(active);
 cli(['collect', key, '--apply', '--deadline-ms=15000'], { native: true, hidden: true, failure: /REJECTED/ });
 expect(cli(['status', key])).toMatchObject({ native: { passed: false, code: 'VALIDATION_MISSING' },
   latestTechnicalValidation: { verdict: 'REJECTED', report: { observed: 1, qualified: 0, held: 1 } } });
 expect(await source()).toEqual(active);
 await db.source.update({ where: { key }, data: { status: 'RETIRED' } });
 expect(cli(['register', input, '--apply'])).toMatchObject({ created: false, status: 'RETIRED' });
 cli(['promote', key, `--revision=${draft.currentRevisionId}`, '--apply'], { failure: /RETIRED/ });
 expect(readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(4);
}, 120_000);

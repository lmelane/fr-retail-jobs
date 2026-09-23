import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { ObjectStore } from '../retention/objectStore.js';
import { readSourceEvidence } from '../capture/sourceEvidence.js';
import { readRequestData } from '../capture/requestDataRead.js';
import { readExtractionManifest } from '../capture/manifest.js';
import { readRawBlob } from '../capture/store.js';
import { captureReaderRevision } from '../capture/revision.js';
import { CRAWLER_IDENTITY } from '../lib/crawlerIdentity.js';
import { accessDecision, OWNER_DECISION_AT, OWNER_DECISION_SCOPE, type RobotsObserved } from '../lib/accessDecision.js';
import { robotsVerdictFor } from '../lib/robotsVerdict.js';
import { readRobotsResponse } from '../lib/robotsResponse.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { invalidAccess, matchingAccessScope, recentAccess, SOURCE_ACCESS_MAX_AGE_MS, SOURCE_ACCESS_POLICY, type AccessDocument } from './accessScope.js';

const MAX_REQUESTS = 100_000;
type Observations = Record<RobotsObserved, number>;
const emptyObservations = (): Observations => ({ ALLOWED: 0, DISALLOWED: 0, NO_ROBOTS: 0, UNREACHABLE: 0 });
export type AccessEvidenceReport = {
  policy: string; readerRevision: string; sourceKey: string; sourceRevisionId: string; captureBatchId: string;
  captureCount: number; requestCount: number; requestSetHash: string; validUntil: string;
  authorizationBasis: 'OWNER_SECTOR_AUTHORIZATION'; ownerDecisionScope: string; ownerDecisionAt: string;
  scopeCounts: number[]; observations: Observations;
  robots: { captureBatchId: string; origin: string; responseId: string; bodyHash: string; observedAt: string;
    status: number; observationKind: 'RULES' | 'NO_ROBOTS' | 'UNREACHABLE'; nonStandardResponse?: boolean; observations: Observations }[];
};

/** Native HTTP journal only. The reviewer classifies the public surfaces;
 * robots observations, coverage and provenance are computed from RAW bytes. */
export async function inspectSourceAccess(db: PrismaClient, document: Readonly<AccessDocument>, store?: ObjectStore): Promise<AccessEvidenceReport> {
  const now = new Date();
  const batch = await db.captureBatch.findUniqueOrThrow({ where: { id: document.captureBatchId! }, include: { outcome: true } });
  if (batch.sourceKey !== document.sourceKey || batch.sourceRevisionId !== document.sourceRevisionId ||
    batch.purpose !== 'JOBS' || batch.formatVersion !== 2 || batch.readerRevision !== captureReaderRevision() ||
    batch.outcome?.status !== 'EXTRACTED' || batch.outcome.transportCoverage !== 'HTTP_ONLY' ||
    !recentAccess(batch.startedAt, now)) return invalidAccess('Recent HTTP-only extraction of the current source revision and reader required');
  await readExtractionManifest(db, batch.id, store);
  const report: AccessEvidenceReport = { policy: SOURCE_ACCESS_POLICY, readerRevision: captureReaderRevision(),
    sourceKey: document.sourceKey, sourceRevisionId: document.sourceRevisionId, captureBatchId: batch.id,
    captureCount: 0, requestCount: 0, requestSetHash: '',
    validUntil: new Date(Math.min(batch.startedAt.getTime(), Date.parse(document.checkedAt)) + SOURCE_ACCESS_MAX_AGE_MS).toISOString(),
    authorizationBasis: 'OWNER_SECTOR_AUTHORIZATION', ownerDecisionScope: OWNER_DECISION_SCOPE, ownerDecisionAt: OWNER_DECISION_AT,
    scopeCounts: document.scopes.map(() => 0), observations: emptyObservations(), robots: [] };
  const policies = new Map<string, { text: string | null; report: AccessEvidenceReport['robots'][number] }>();
  const observedMethods = document.scopes.map(() => new Set<string>());
  const observedQueryNames = document.scopes.map(() => new Set<string>());
  for (const id of document.robotsCaptureIds) {
    const evidence = await readSourceEvidence(db, id, store);
    if (evidence.batch.purpose !== 'SOURCE_ACCESS' || evidence.batch.sourceKey !== document.sourceKey ||
      evidence.batch.sourceRevisionId !== document.sourceRevisionId || evidence.batch.readerRevision !== report.readerRevision ||
      !recentAccess(evidence.batch.startedAt, now) || Date.parse(document.checkedAt) < evidence.batch.startedAt.getTime() - 300_000) return invalidAccess('Access-policy evidence is stale or belongs to another source, purpose or reader');
    const initial = new URL(evidence.initialUrl);
    if (initial.protocol !== 'https:' || initial.pathname !== '/robots.txt' || initial.search || policies.has(initial.origin)) return invalidAccess('Exactly one robots capture per observed HTTPS origin required');
    for (const row of evidence.responses) {
      const data = await readRequestData(db, row, store);
      if (!data || data.origin !== 'HTTP_TRANSPORT' || data.hops.length !== 1 || data.hops[0].request.userAgent !== CRAWLER_IDENTITY) return invalidAccess('Robots capture requires observed collector identity on every redirect');
    }
    const last = evidence.responses.at(-1)!;
    let reading: ReturnType<typeof readRobotsResponse>;
    try { reading = readRobotsResponse(last.status!, last.headers as Record<string, unknown>, evidence.body); }
    catch (error) { return invalidAccess(`Robots observation unresolved: ${error instanceof Error ? error.message : 'reading failed'}`); }
    const { kind, text, nonStandard } = reading;
    const item = { captureBatchId: id, origin: initial.origin, responseId: last.id, bodyHash: last.blobHash!,
      observedAt: evidence.batch.startedAt.toISOString(), status: last.status!, observationKind: kind, nonStandardResponse: nonStandard, observations: emptyObservations() };
    report.robots.push(item); policies.set(initial.origin, { text, report: item });
    report.validUntil = new Date(Math.min(Date.parse(report.validUntil), evidence.batch.startedAt.getTime() + SOURCE_ACCESS_MAX_AGE_MS)).toISOString();
  }
  if (Date.parse(document.checkedAt) < batch.startedAt.getTime() - 300_000) return invalidAccess('Access review predates its extraction');
  // Stream receipts in bounded pages. Full URLs remain in private request blobs;
  // public reports contain counts, hashes and collector identity only.
  const requestSet = createHash('sha256');
  let next = 0;
  for (;;) {
    const rows = await db.rawCapture.findMany({ where: { batchId: batch.id, sequence: { gte: next } }, orderBy: { sequence: 'asc' }, take: 100 });
    if (!rows.length) break;
    for (const row of rows) {
      if (row.sequence !== next++ || ++report.captureCount > MAX_REQUESTS) return invalidAccess('Native request journal is non-contiguous or exceeds the inspection budget');
      const data = await readRequestData(db, row, store);
      if (!data || data.origin !== 'HTTP_TRANSPORT' || !data.hops.length) return invalidAccess('Every request needs native HTTP provenance; browser and historical unknown transports cannot certify access');
      if (row.blobHash) await readRawBlob(db, row.blobHash, store);
      const covered = [];
      for (const hop of data.hops) {
        if (++report.requestCount > MAX_REQUESTS) return invalidAccess('Native request hops exceed the inspection budget');
        const index = matchingAccessScope(document.scopes, hop.request);
        const url = new URL(hop.request.url);
        observedMethods[index].add(hop.request.method);
        for (const key of url.searchParams.keys()) observedQueryNames[index].add(key);
        const policy = policies.get(url.origin);
        if (!policy) return invalidAccess('A request origin has no native robots observation');
        let observed: RobotsObserved = policy.report.observationKind === 'RULES' ? 'UNREACHABLE' : policy.report.observationKind;
        if (policy.report.observationKind === 'RULES') {
          try { observed = robotsVerdictFor(policy.text, url.pathname + url.search); }
          catch { return invalidAccess('Robots rules evaluation failed; no access decision can be issued'); }
        }
        if (accessDecision({ robotsObserved: observed, accessSurface: document.scopes[index].surface }).effectiveAccessDecision !== 'ALLOWED') return invalidAccess('Observed request is not covered by the owner authorization');
        report.scopeCounts[index]++; report.observations[observed]++; policy.report.observations[observed]++;
        covered.push({ scope: index, robotsCaptureId: policy.report.captureBatchId, observed });
      }
      requestSet.update(evidenceHash({ id: row.id, sequence: row.sequence, requestDataHash: row.requestDataHash, blobHash: row.blobHash, covered }) + '\n');
    }
  }
  if (!report.requestCount || report.scopeCounts.some(count => !count) || report.robots.some(item => Object.values(item.observations).every(count => !count))) return invalidAccess('Every reviewed scope and robots observation must cover an actually observed request');
  if (document.scopes.some((scope, index) => scope.methods.some(method => !observedMethods[index].has(method)) ||
    scope.query.variable.some(key => !observedQueryNames[index].has(key)))) return invalidAccess('Every declared method and variable query name needs an observed native witness');
  report.requestSetHash = requestSet.digest('hex');
  return report;
}

import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { declaredExpiry, EXPIRY_READER_VERSION, type ExpiryEvidence } from '../normalize/expiry.js';
import { lockCompanyRows, lockSourceWrites } from '../lib/writeLocks.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { storeMaintenancePlan } from '../lib/maintenancePlan.js';
import { captureReaderRevision } from '../capture/revision.js';
import { readAdapterObservation } from '../capture/observations.js';
import type { ObjectStore } from '../retention/objectStore.js';
import { PIPELINE_VERSION } from './version.js';
import {
  readExpiryPublicationProof,
  ExpiryPublicationReview,
  type ExpiryPublicationProof,
} from '../publication/expiry-proof.js';

const MAX_ROWS = 1000;
const MAX_RAW_BYTES = 32_000_000;
const rawHash = (raw: unknown) => createHash('sha256').update(JSON.stringify(raw)).digest('hex');
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const select = {
  id: true,
  jobId: true,
  sourceKey: true,
  externalId: true,
  url: true,
  raw: true,
  isActive: true,
  firstSeenAt: true,
  lastSeenAt: true,
  captureBatchId: true,
  captureOutputId: true,
  expiresAt: true,
  expiryEvidence: true,
  job: { select: { companyId: true } },
} as const;
type Row = Prisma.JobSourceGetPayload<{ select: typeof select }>;
type Catalogue = { kind: string; config: Prisma.JsonValue; status: string };
type Before = { expiresAt: string | null; expiryEvidence: Prisma.JsonValue };
type Proof =
  | { origin: 'CURRENT_RAW'; inputHash: string; observedAt: string }
  | { origin: 'PREVIOUS_OBSERVATION'; inputHash: string; observedAt: string; observationId: string }
  | { origin: 'RETIRED_RULE'; rule: 'FLATCHR_CONTRACT_END' | 'VOLCANIC_UNQUALIFIED_LIST_END' };
type Entry = {
  id: string;
  jobId: string | null;
  companyId: string | null;
  sourceKey: string;
  externalId: string;
  kind: string;
  stateHash: string;
  rawHash: string;
  before: Before;
  expiresAt: string | null;
  evidence: ExpiryEvidence | null;
  proof: Proof;
  publicationProof: ExpiryPublicationProof | null;
};
type Review = { id: string; sourceKey: string; externalId: string; reason: string };
type Body = {
  version: 3;
  kind: 'SOURCE_EXPIRY';
  revision: string;
  allowedKeys: string[];
  entries: Entry[];
  reviews: Review[];
};
export type ExpiryBackfillPlan = Body & { planHash: string };
type Witness = {
  raw: Prisma.JsonValue;
  observedAt: Date;
  captureBatchId: string | null;
  captureOutputId: string | null;
  id?: string;
};
type Decision =
  | { changed: boolean; expiresAt: string | null; evidence: ExpiryEvidence | null; proof: Proof; witness?: Witness }
  | { review: string }
  | null;

function before(row: Row): Before {
  return { expiresAt: row.expiresAt?.toISOString() ?? null, expiryEvidence: row.expiryEvidence };
}
function stateHash(row: Row, catalogue: Catalogue) {
  return evidenceHash({ ...row, raw: evidenceHash(row.raw), catalogue });
}
function cacheEvidence(value: Prisma.JsonValue): Partial<ExpiryEvidence> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<ExpiryEvidence>) : {};
}
/** Only rules explicitly disproved by the reader audit can be removed without a replacement date. */
function retiredRule(kind: string, value: Prisma.JsonValue): Extract<Proof, { origin: 'RETIRED_RULE' }> | null {
  const e = cacheEvidence(value);
  if (!Number.isInteger(e.readerVersion) || e.readerVersion! < 1) return null;
  if (kind === 'flatchr' && e.readerVersion! <= 2 && e.path === '$.vacancy.end_date')
    return { origin: 'RETIRED_RULE', rule: 'FLATCHR_CONTRACT_END' };
  if (kind === 'volcanic' && e.readerVersion! <= 3 && e.path === '$.end_date')
    return { origin: 'RETIRED_RULE', rule: 'VOLCANIC_UNQUALIFIED_LIST_END' };
  return null;
}
function decide(row: Row, kind: string, previous?: Witness): Decision {
  const current = declaredExpiry(kind, row.raw);
  if (current) {
    const after = { expiresAt: current.expiresAt?.toISOString() ?? null, expiryEvidence: current.evidence };
    return {
      changed: evidenceHash(before(row)) !== evidenceHash(after),
      expiresAt: after.expiresAt,
      evidence: current.evidence,
      proof: { origin: 'CURRENT_RAW', inputHash: evidenceHash(row.raw), observedAt: row.lastSeenAt.toISOString() },
      witness: {
        raw: row.raw,
        observedAt: row.lastSeenAt,
        captureBatchId: row.captureBatchId,
        captureOutputId: row.captureOutputId,
      },
    };
  }
  if (row.expiresAt === null && row.expiryEvidence === null) return null;
  const retired = retiredRule(kind, row.expiryEvidence);
  if (retired) return { changed: true, expiresAt: null, evidence: null, proof: retired };
  const e = cacheEvidence(row.expiryEvidence);
  if (
    typeof e.rawHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(e.rawHash) ||
    typeof e.path !== 'string' ||
    typeof e.value !== 'string'
  )
    return { review: 'STORED_DEADLINE_WITHOUT_USABLE_PROOF' };
  if (!previous) return { review: 'PREVIOUS_DEADLINE_OBSERVATION_REQUIRED' };
  const replayed = declaredExpiry(kind, previous.raw);
  if (
    !replayed ||
    (replayed.expiresAt?.toISOString() ?? null) !== (row.expiresAt?.toISOString() ?? null) ||
    replayed.evidence.path !== e.path ||
    replayed.evidence.value !== e.value
  )
    return { review: 'PREVIOUS_DEADLINE_NO_LONGER_CORROBORATED' };
  const after = { expiresAt: replayed.expiresAt?.toISOString() ?? null, expiryEvidence: replayed.evidence };
  return {
    changed: evidenceHash(before(row)) !== evidenceHash(after),
    expiresAt: after.expiresAt,
    evidence: replayed.evidence,
    proof: {
      origin: 'PREVIOUS_OBSERVATION',
      inputHash: evidenceHash(previous.raw),
      observedAt: previous.observedAt.toISOString(),
      observationId: previous.id!,
    },
    witness: previous,
  };
}
function entryFor(
  row: Row,
  catalogue: Catalogue,
  d: Exclude<Decision, null | { review: string }>,
  publicationProof: ExpiryPublicationProof | null,
): Entry {
  return {
    id: row.id,
    jobId: row.jobId,
    companyId: row.job?.companyId ?? null,
    sourceKey: row.sourceKey,
    externalId: row.externalId,
    kind: catalogue.kind,
    stateHash: stateHash(row, catalogue),
    rawHash: rawHash(row.raw),
    before: before(row),
    expiresAt: d.expiresAt,
    evidence: d.evidence,
    proof: d.proof,
    publicationProof,
  };
}
async function previousWitness(
  db: PrismaClient,
  row: Pick<Row, 'sourceKey' | 'externalId' | 'expiryEvidence' | 'lastSeenAt'>,
  store: ObjectStore | undefined,
  budget: { used: number },
  id?: string,
): Promise<Witness | undefined> {
  const hash = cacheEvidence(row.expiryEvidence).rawHash;
  if (typeof hash !== 'string') return undefined;
  // Inspect sizes in PostgreSQL before materializing a possibly large JSON payload.
  // The observation is immutable, except for transfer to its verified cold blob.
  const [match] = await db.$queryRaw<Array<{ id: string; bytes: number | null }>>`SELECT o.id,
    CASE WHEN o.raw IS NOT NULL THEN octet_length(o.raw::text) ELSE b."byteLength" END AS bytes
    FROM "SourceObservation" o LEFT JOIN "RawBlob" b ON b.hash=o."rawBlobHash"
    WHERE o."sourceKey"=${row.sourceKey} AND o."externalId"=${row.externalId}
      AND o."contentHash"=${hash} AND o."annotationHash"='' AND o."publicationHold" IS NULL
      AND o."observedAt"<=${row.lastSeenAt} AND (${id ?? null}::text IS NULL OR o.id=${id ?? null}) LIMIT 1`;
  if (!match || match.bytes === null) return undefined;
  budget.used += match.bytes;
  if (budget.used > MAX_RAW_BYTES) throw Error('Previous expiry RAW exceeds the bounded page size');
  const observation = await readAdapterObservation(db, match.id, store);
  return {
    id: observation.id,
    raw: observation.raw,
    observedAt: observation.observedAt,
    captureBatchId: observation.captureBatchId,
    captureOutputId: observation.captureOutputId,
  };
}

/** Snapshot the page before loading any cold previous evidence outside transactions. */
export async function planSourceExpiries(
  db: PrismaClient,
  keys: string[],
  afterId?: string,
  limit = 250,
  store?: ObjectStore,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROWS || keys.some((k) => !k.trim()))
    throw Error('Expiry page size must be 1–1000 with explicit source keys');
  const allowedKeys = [...new Set(keys)].sort();
  const page = await db.$transaction(
    async (tx) => {
      const sources = await tx.source.findMany({
        where: { key: { in: allowedKeys } },
        select: { key: true, kind: true, config: true, status: true },
      });
      const catalogue = new Map(sources.map((s) => [s.key, s]));
      for (const key of allowedKeys) if (!catalogue.has(key)) throw Error(`Unknown source: ${key}`);
      const sizes = await tx.$queryRaw<
        Array<{ id: string; bytes: number }>
      >`SELECT id, octet_length(COALESCE(raw::text,'null'))::integer AS bytes FROM "JobSource"
      WHERE "sourceKey"=ANY(${allowedKeys}::text[]) AND (${afterId ?? null}::text IS NULL OR id>${afterId ?? null}) ORDER BY id LIMIT ${limit + 1}`;
      const selected = sizes.slice(0, limit);
      if (selected.reduce((n, r) => n + r.bytes, 0) > MAX_RAW_BYTES)
        throw Error('Expiry RAW exceeds the bounded page size');
      const rows = await tx.jobSource.findMany({
        where: { id: { in: selected.map((r) => r.id) } },
        select,
        orderBy: { id: 'asc' },
      });
      return {
        rows,
        sources,
        rawBytes: selected.reduce((n, r) => n + r.bytes, 0),
        nextCursor: sizes.length > limit ? selected.at(-1)!.id : undefined,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  const catalogue = new Map(page.sources.map((s) => [s.key, s]));
  const entries: Entry[] = [],
    reviews: Review[] = [];
  const budget = { used: page.rawBytes, limit: MAX_RAW_BYTES };
  const bodies = new Map<string, Buffer>();
  for (const row of page.rows) {
    const source = catalogue.get(row.sourceKey)!;
    let decision = decide(row, source.kind);
    if (decision && 'review' in decision && decision.review === 'PREVIOUS_DEADLINE_OBSERVATION_REQUIRED') {
      try {
        decision = decide(row, source.kind, await previousWitness(db, row, store, budget));
      } catch (error) {
        if (String(error).includes('bounded page size')) throw error;
        decision = { review: 'PREVIOUS_DEADLINE_ARCHIVE_UNAVAILABLE' };
      }
    }
    if (!decision) continue;
    if ('review' in decision)
      reviews.push({ id: row.id, sourceKey: row.sourceKey, externalId: row.externalId, reason: decision.review });
    else {
      try {
        const publicationProof = decision.witness
          ? await readExpiryPublicationProof(
              db,
              source,
              {
                sourceKey: row.sourceKey,
                externalId: row.externalId,
                url: row.url,
                ...decision.witness,
              },
              { bodies, budget, store, allowFetch: true },
            )
          : null;
        if (decision.changed) entries.push(entryFor(row, source, decision, publicationProof));
      } catch (error) {
        if (!(error instanceof ExpiryPublicationReview)) throw error;
        reviews.push({ id: row.id, sourceKey: row.sourceKey, externalId: row.externalId, reason: error.reason });
      }
    }
  }
  const body: Body = {
    version: 3,
    kind: 'SOURCE_EXPIRY',
    revision: captureReaderRevision(),
    allowedKeys,
    entries,
    reviews,
  };
  return { plan: { ...body, planHash: evidenceHash(body) }, scanned: page.rows.length, nextCursor: page.nextCursor };
}

function verify(plan: ExpiryBackfillPlan, expectedHash: string) {
  if (
    !plan ||
    typeof plan !== 'object' ||
    Object.keys(plan).sort().join(',') !== 'allowedKeys,entries,kind,planHash,reviews,revision,version' ||
    !Array.isArray(plan.allowedKeys) ||
    !Array.isArray(plan.entries) ||
    !Array.isArray(plan.reviews) ||
    plan.allowedKeys.some((k) => typeof k !== 'string' || !k.trim()) ||
    evidenceHash(plan.allowedKeys) !== evidenceHash([...new Set(plan.allowedKeys)].sort()) ||
    plan.entries.some((e) => !e || typeof e !== 'object' || typeof e.id !== 'string' || !e.proof)
  )
    throw Error('Invalid expiry plan shape');
  const { planHash, ...body } = plan;
  if (
    plan.version !== 3 ||
    plan.kind !== 'SOURCE_EXPIRY' ||
    plan.revision !== captureReaderRevision() ||
    planHash !== expectedHash ||
    evidenceHash(body) !== planHash
  )
    throw Error('Invalid expiry plan, hash or revision');
  if (
    plan.entries.length > MAX_ROWS ||
    new Set(plan.entries.map((e) => e.id)).size !== plan.entries.length ||
    plan.entries.some(
      (e) =>
        !plan.allowedKeys.includes(e.sourceKey) ||
        (e.evidence !== null && e.evidence.readerVersion !== EXPIRY_READER_VERSION),
    )
  )
    throw Error('Invalid expiry plan scope');
  if (plan.reviews.length) throw Error('Expiry plan has unresolved evidence reviews');
}
async function isApplied(db: Pick<Prisma.TransactionClient, 'dataCorrection'>, plan: ExpiryBackfillPlan) {
  const applied = await db.dataCorrection.findMany({
    where: { batchId: `source-expiry:${plan.planHash}` },
    select: { entityId: true, entityType: true, planHash: true },
  });
  if (!applied.length) return false;
  const ids = new Set(applied.map((r) => r.entityId));
  if (
    applied.length !== plan.entries.length ||
    ids.size !== plan.entries.length ||
    plan.entries.some((e) => !ids.has(e.id)) ||
    applied.some((r) => r.planHash !== plan.planHash || r.entityType !== 'JobSource')
  )
    throw Error('Expiry audit mismatch');
  return true;
}

/** Exact, evidence-bound cache changes; no activation, observation refresh or Job projection write. */
export async function applySourceExpiries(
  db: PrismaClient,
  plan: ExpiryBackfillPlan,
  expectedHash: string,
  store?: ObjectStore,
) {
  verify(plan, expectedHash);
  await storeMaintenancePlan(db, { id: plan.planHash, kind: plan.kind, version: plan.version, revision: plan.revision, body: plan });
  if (!plan.entries.length) return { written: 0, alreadyApplied: false };
  if (await isApplied(db, plan)) return { written: 0, alreadyApplied: true };
  const snapshot = await db.$transaction(
    async (tx) => {
      // The earlier fast check can race with another successful application.
      // Read the journal and row snapshot in the same MVCC snapshot.
      if (await isApplied(tx, plan)) return { alreadyApplied: true as const };
      const [size] = await tx.$queryRaw<
        Array<{ bytes: bigint }>
      >`SELECT COALESCE(sum(octet_length(COALESCE(raw::text,'null'))),0)::bigint AS bytes FROM "JobSource" WHERE id=ANY(${plan.entries.map((e) => e.id)}::text[])`;
      if (size.bytes > BigInt(MAX_RAW_BYTES)) throw Error('Expiry RAW exceeds the bounded page size');
      const rows = await tx.jobSource.findMany({ where: { id: { in: plan.entries.map((e) => e.id) } }, select });
      const sources = await tx.source.findMany({
        where: { key: { in: plan.allowedKeys } },
        select: { key: true, kind: true, config: true, status: true },
      });
      return { alreadyApplied: false as const, rows, sources, bytes: Number(size.bytes) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 },
  );
  if (snapshot.alreadyApplied) return { written: 0, alreadyApplied: true };
  const initialRows = new Map(snapshot.rows.map((row) => [row.id, row]));
  const initialSources = new Map(snapshot.sources.map((source) => [source.key, source]));
  const previous = new Map<string, Witness>();
  const bodies = new Map<string, Buffer>();
  const budget = { used: snapshot.bytes, limit: MAX_RAW_BYTES };
  // All archive reads finish before write locks; immutable bodies are reused below.
  try {
    for (const e of plan.entries) {
      const row = initialRows.get(e.id),
        source = initialSources.get(e.sourceKey);
      if (!row || !source || stateHash(row, source) !== e.stateHash)
        throw Error(`Stale or unsupported expiry evidence: ${e.id}`);
      if (e.proof.origin === 'PREVIOUS_OBSERVATION') {
        const witness = await previousWitness(db, row, store, budget, e.proof.observationId);
        if (!witness || evidenceHash(witness.raw) !== e.proof.inputHash)
          throw Error('Previous expiry observation changed or unavailable');
        previous.set(e.id, witness);
      }
      const decision = decide(row, source.kind, previous.get(e.id));
      if (!decision || 'review' in decision || !decision.changed)
        throw Error(`Stale or unsupported expiry evidence: ${e.id}`);
      const publicationProof = decision.witness
        ? await readExpiryPublicationProof(
            db,
            source,
            {
              sourceKey: row.sourceKey,
              externalId: row.externalId,
              url: row.url,
              ...decision.witness,
            },
            { bodies, budget, store, allowFetch: true },
          )
        : null;
      if (evidenceHash(entryFor(row, source, decision, publicationProof)) !== evidenceHash(e))
        throw Error(`Stale or unsupported expiry evidence: ${e.id}`);
    }
  } catch (error) {
    // A concurrent worker may have completed while this archive read failed.
    if (await isApplied(db, plan)) return { written: 0, alreadyApplied: true };
    throw error;
  }
  return db.$transaction(
    async (tx) => {
      const batchId = `source-expiry:${plan.planHash}`;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${batchId},0))`;
      for (const key of [...new Set(plan.entries.map((e) => e.sourceKey))].sort())
        await lockSourceWrites(tx, key, true);
      await lockCompanyRows(
        tx,
        plan.entries.flatMap((e) => e.companyId ? [e.companyId] : []),
      );
      await tx.$queryRaw`SELECT key FROM "Source" WHERE key=ANY(${plan.allowedKeys}::text[]) ORDER BY key FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "Job" WHERE id=ANY(${[...new Set(plan.entries.flatMap((e) => e.jobId ? [e.jobId] : []))]}::text[]) ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "JobSource" WHERE id=ANY(${plan.entries.map((e) => e.id)}::text[]) ORDER BY id FOR UPDATE`;
      if (await isApplied(tx, plan)) return { written: 0, alreadyApplied: true };
      const size = await tx.$queryRaw<
        Array<{ bytes: bigint }>
      >`SELECT COALESCE(sum(octet_length(COALESCE(raw::text,'null'))),0)::bigint AS bytes FROM "JobSource" WHERE id=ANY(${plan.entries.map((e) => e.id)}::text[])`;
      if (size[0].bytes + BigInt(budget.used - snapshot.bytes) > BigInt(MAX_RAW_BYTES))
        throw Error('Expiry RAW exceeds the bounded page size');
      const catalogue = new Map(
        (
          await tx.source.findMany({
            where: { key: { in: plan.allowedKeys } },
            select: { key: true, kind: true, config: true, status: true },
          })
        ).map((s) => [s.key, s]),
      );
      const rows = new Map(
        (await tx.jobSource.findMany({ where: { id: { in: plan.entries.map((e) => e.id) } }, select })).map((r) => [
          r.id,
          r,
        ]),
      );
      const decisions = new Map<string, Exclude<Decision, null | { review: string }>>();
      for (const e of plan.entries) {
        const row = rows.get(e.id),
          source = catalogue.get(e.sourceKey);
        const d = row && source ? decide(row, source.kind, previous.get(e.id)) : null;
        if (!row || !source || !d || 'review' in d || !d.changed)
          throw Error(`Stale or unsupported expiry evidence: ${e.id}`);
        const publicationProof = d.witness
          ? await readExpiryPublicationProof(
              tx,
              source,
              {
                sourceKey: row.sourceKey,
                externalId: row.externalId,
                url: row.url,
                ...d.witness,
              },
              { bodies, budget, allowFetch: false },
            )
          : null;
        if (evidenceHash(entryFor(row, source, d, publicationProof)) !== evidenceHash(e))
          throw Error(`Stale or unsupported expiry evidence: ${e.id}`);
        decisions.set(e.id, d);
      }
      for (const e of plan.entries) {
        const d = decisions.get(e.id)!;
        if (d.witness && e.evidence)
          await tx.sourceObservation.createMany({
            data: [
              {
                sourceKey: e.sourceKey,
                externalId: e.externalId,
                contentHash: e.evidence.rawHash,
                raw: json(d.witness.raw),
                pipelineVersion: PIPELINE_VERSION,
                observedAt: d.witness.observedAt,
                captureBatchId: d.witness.captureBatchId,
                captureOutputId: d.witness.captureOutputId,
              },
            ],
            skipDuplicates: true,
          });
        await tx.jobSource.update({
          where: { id: e.id },
          data: {
            expiresAt: e.expiresAt ? new Date(e.expiresAt) : null,
            expiryEvidence: e.evidence ? json(e.evidence) : Prisma.DbNull,
          },
        });
        await tx.dataCorrection.create({
          data: {
            batchId,
            planHash: plan.planHash,
            commitHash: plan.revision,
            finding: 'SOURCE_DECLARED_EXPIRY',
            entityType: 'JobSource',
            entityId: e.id,
            before: json(e.before),
            after: json({ expiresAt: e.expiresAt, expiryEvidence: e.evidence }),
            evidence: json({
              proof: e.proof,
              publicationProof: e.publicationProof,
              sourceKey: e.sourceKey,
              externalId: e.externalId,
              jobId: e.jobId,
              stateHash: e.stateHash,
            }),
          },
        });
      }
      return { written: plan.entries.length, alreadyApplied: false };
    },
    { maxWait: 15_000, timeout: 60_000 },
  );
}

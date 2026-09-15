import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { scalarSourceFacts, type SourceFacts } from '@catwalks/db/source-facts';
import { selectApplySource } from '@catwalks/db/publications';
import { storedAmount } from '@catwalks/db/money';
import { KIND_TO_ATS } from '../ats/catalogKinds.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { storeMaintenancePlan, recordDataCorrection } from '../lib/maintenancePlan.js';
import { lockCompanyRows, lockSourceWrites } from '../lib/writeLocks.js';
import { captureReaderRevision } from '../capture/revision.js';
import { readSourceFacts } from './index.js';

const SCALARS = ['salaryMin','salaryMax','salaryCurrency','salaryPeriod','educationLevel','workplaceType','postalCode','latitude','longitude'] as const;
const jobSelect = { id: true, companyId: true, isActive: true, withdrawnAt: true, mergedIntoId: true,
  canonicalSourceKey: true, canonicalExternalId: true, url: true,
  salaryMin: true, salaryMax: true, salaryCurrency: true, salaryPeriod: true, educationLevel: true,
  workplaceType: true, postalCode: true, latitude: true, longitude: true,
  sources: { select: { id: true, sourceKey: true, externalId: true, sourceTier: true, url: true, isActive: true, expiresAt: true } },
} as const;
type Job = Prisma.JobGetPayload<{ select: typeof jobSelect }>;
type Publication = Prisma.JobSourceGetPayload<Record<string, never>>;
function scalars(job: Job) { return Object.fromEntries(SCALARS.map(key => [key, key === 'salaryMin' || key === 'salaryMax' ? job[key]?.toString() ?? null : job[key]])); }
function jobState(job: Job) { return { id: job.id, companyId: job.companyId, isActive: job.isActive, withdrawnAt: job.withdrawnAt,
  mergedIntoId: job.mergedIntoId, owner: selectApplySource(job.sources, job)?.id ?? null, values: scalars(job) }; }
/** Prisma's Float result conversion also rounds some coordinates. Read the
 * database text when comparing exact repair values so the next preview is empty. */
async function hydrateCoordinates(db: Prisma.TransactionClient, jobs: Job[]) {
  if (!jobs.length) return;
  const rows = await db.$queryRaw<Array<{ id: string; latitude: string | null; longitude: string | null }>>`
    SELECT id, latitude::text, longitude::text FROM "Job" WHERE id=ANY(${jobs.map(job => job.id)}::text[])`;
  const coordinates = new Map(rows.map(row => [row.id, row]));
  for (const job of jobs) {
    const row = coordinates.get(job.id);
    if (!row) throw new Error('Source-facts job disappeared');
    job.latitude = row.latitude === null ? null : Number(row.latitude);
    job.longitude = row.longitude === null ? null : Number(row.longitude);
  }
}
function sourceState(source: Publication) { return { id: source.id, jobId: source.jobId, sourceKey: source.sourceKey, externalId: source.externalId,
  rawHash: evidenceHash(source.raw), factsHash: evidenceHash(source.sourceFacts), lastSeenAt: source.lastSeenAt,
  captureBatchId: source.captureBatchId, captureOutputId: source.captureOutputId }; }
type Entry = { id: string; sourceKey: string; jobId: string; companyId: string; beforeHash: string; jobBeforeHash: string;
  before: Record<string, unknown>; after: ReturnType<typeof scalarSourceFacts> | null; facts: SourceFacts };
type Body = { version: 1; kind: 'SOURCE_FACTS'; revision: string; keys: string[]; entries: Entry[]; nextCursor: string | null };
export type FactsRepairPlan = Body & { planHash: string };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function verify(plan: FactsRepairPlan, expectedHash: string) {
  const { planHash, ...body } = plan;
  if (planHash !== expectedHash || evidenceHash(body) !== planHash || plan.version !== 1 || plan.kind !== 'SOURCE_FACTS' ||
    plan.revision !== captureReaderRevision() || plan.entries.length > 1000 || new Set(plan.entries.map(entry => entry.id)).size !== plan.entries.length ||
    plan.entries.some(entry => !plan.keys.includes(entry.sourceKey))) throw new Error('Invalid or obsolete source-facts plan');
}

/** Explicit source scope and bounded pages. The review file contains exact before/after values and proof paths. */
export async function planFactsRepair(db: PrismaClient, keys: string[], options: { limit?: number; cursor?: string } = {}): Promise<FactsRepairPlan> {
  const limit = options.limit ?? 250;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !keys.length || keys.some(key => !key.trim())) throw new Error('Explicit source keys and a page size of 1–1000 are required');
  const allowed = [...new Set(keys)].sort();
  const sources = await db.source.findMany({ where: { key: { in: allowed } }, select: { key: true, kind: true } });
  const types = new Map(sources.map(source => [source.key, KIND_TO_ATS[source.kind]]));
  if (allowed.some(key => !types.get(key))) throw new Error('Unknown source or unregistered source kind');
  const rows = await db.jobSource.findMany({ where: { sourceKey: { in: allowed }, ...(options.cursor ? { id: { gt: options.cursor } } : {}) },
    include: { job: { select: jobSelect } }, orderBy: { id: 'asc' }, take: limit + 1 });
  const page = rows.slice(0, limit);
  await hydrateCoordinates(db, page.map(row => row.job));
  const body: Body = { version: 1, kind: 'SOURCE_FACTS', revision: captureReaderRevision(), keys: allowed,
    nextCursor: rows.length > limit ? page.at(-1)!.id : null,
    entries: page.flatMap(source => {
      const facts = readSourceFacts(types.get(source.sourceKey)!, source.raw), state = jobState(source.job);
      const after = state.owner === source.id ? scalarSourceFacts(facts) : null;
      if (evidenceHash(source.sourceFacts) === evidenceHash(facts) && (!after || evidenceHash(after) === evidenceHash(state.values))) return [];
      return [{ id: source.id, sourceKey: source.sourceKey, jobId: source.jobId, companyId: source.job.companyId,
        beforeHash: evidenceHash(sourceState(source)), jobBeforeHash: evidenceHash(state), before: scalars(source.job),
        after, facts }];
    }),
  };
  return { ...body, planHash: evidenceHash(body) };
}

/** Each job is atomic. A restarted page skips completed groups and refuses changed inputs. */
export async function applyFactsRepair(db: PrismaClient, plan: FactsRepairPlan, expectedHash: string) {
  verify(plan, expectedHash);
  await storeMaintenancePlan(db, { id: plan.planHash, kind: plan.kind, version: plan.version, revision: plan.revision, body: plan });
  const groups = new Map<string, Entry[]>();
  for (const entry of plan.entries) groups.set(entry.jobId, [...groups.get(entry.jobId) ?? [], entry]);
  let applied = 0, alreadyApplied = 0;
  for (const [jobId, entries] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const result = await db.$transaction(async tx => {
      for (const key of [...new Set(entries.map(entry => entry.sourceKey))].sort()) await lockSourceWrites(tx, key);
      await lockCompanyRows(tx, [...new Set(entries.map(entry => entry.companyId))]);
      await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ${jobId} FOR UPDATE`;
      const batchId = `source-facts:${plan.planHash}`;
      const done = await tx.dataCorrection.count({ where: { batchId, entityType: 'JobSource', entityId: { in: entries.map(entry => entry.id) } } });
      if (done === entries.length) return 'ALREADY_APPLIED';
      if (done) throw new Error('Partial correction group requires investigation');
      const job = await tx.job.findUniqueOrThrow({ where: { id: jobId }, select: jobSelect });
      await hydrateCoordinates(tx, [job]);
      if (entries.some(entry => entry.jobBeforeHash !== evidenceHash(jobState(job)))) throw new Error('Source-facts job or owner changed');
      const owner = selectApplySource(job.sources, job);
      for (const entry of entries) {
        const source = await tx.jobSource.findUniqueOrThrow({ where: { id: entry.id } });
        const catalogue = await tx.source.findUniqueOrThrow({ where: { key: source.sourceKey }, select: { kind: true } });
        if (source.sourceKey !== entry.sourceKey || evidenceHash(sourceState(source)) !== entry.beforeHash) throw new Error('Source-facts input changed');
        const type = KIND_TO_ATS[catalogue.kind];
        if (!type || evidenceHash(readSourceFacts(type, source.raw)) !== evidenceHash(entry.facts)) throw new Error('Source-facts reader or source kind changed');
        await tx.$executeRaw`UPDATE "JobSource" SET "sourceFacts"=${JSON.stringify(entry.facts)}::jsonb WHERE id=${source.id}`;
        if (owner?.id === source.id) {
          const values = scalarSourceFacts(entry.facts);
          if (evidenceHash(values) !== evidenceHash(entry.after)) throw new Error('Source-facts projection changed');
          const { latitude, longitude, ...scalars } = values;
          await tx.job.update({ where: { id: jobId }, data: { ...scalars, salaryMin: storedAmount(values.salaryMin), salaryMax: storedAmount(values.salaryMax) } });
          await tx.$executeRaw`UPDATE "Job" SET latitude=${latitude == null ? null : String(latitude)}::double precision,
            longitude=${longitude == null ? null : String(longitude)}::double precision WHERE id=${jobId}`;
        }
        await recordDataCorrection(tx, { id: randomUUID(), batchId, planHash: plan.planHash, commitHash: plan.revision,
          finding: 'REBUILD_SOURCE_FACTS_FROM_CURRENT_RAW', entityType: 'JobSource', entityId: source.id,
          before: json({ facts: source.sourceFacts, jobValues: entry.before }), after: json({ facts: entry.facts, jobValues: entry.after ?? entry.before }),
          evidence: json({ inputHash: entry.facts.inputHash, sourceKey: source.sourceKey, externalId: source.externalId,
            captureBatchId: source.captureBatchId, captureOutputId: source.captureOutputId }) });
      }
      return 'APPLIED';
    }, { timeout: 30_000 });
    if (result === 'ALREADY_APPLIED') alreadyApplied += entries.length; else applied += entries.length;
  }
  return { planHash: plan.planHash, applied, alreadyApplied, nextCursor: plan.nextCursor };
}

import { publicationPresentation } from '../publication/presentation.js';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AtsType } from '@prisma/client';
import { loadOccupationTaxonomy, lockOccupationTaxonomy } from '@catwalks/db/occupations';
import { selectApplySource, SOURCE_PRIORITY, type SourceTier } from '@catwalks/db/publications';
import { KIND_TO_ATS } from '../ats/catalogKinds.js';
import { readCapturedPublication, hydrateCapturedJob } from '../capture/publication.js';
import { captureReaderRevision } from '../capture/revision.js';
import { readRawBlob } from '../capture/store.js';
import type { ObjectStore } from '../retention/objectStore.js';
import { toCandidate } from '../pipeline/ingest.js';
import { publicationJobContent } from '../publication/content.js';
import { readSourceFacts, projectSourceFacts } from '../facts/index.js';
import { recordOccupationObservation } from '../occupation/persist.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { lockCompanyRows, lockEmployerCatalogue, lockSourceWrites } from '../lib/writeLocks.js';
import { provenPublicationGroup, publicationIdentityProof } from './match.js';
import { reviewedPublicationGroup } from './decisions.js';
import { declaredExpiry } from '../normalize/expiry.js';

const KIND = 'PUBLICATION_GROUP_REPAIR';
const MAX_REPAIR_BYTES = 32_000_000;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type Database = Prisma.TransactionClient;
type Group = { jobId: string; sourceIds: string[] };
export type GroupRepairRequest = { jobIds: string[]; groups: Array<{ jobId?: string; sourceIds: string[] }>; reason: string };
type Request = { jobIds: string[]; groups: Group[]; reason: string };
const include = { sources: { orderBy: { id: 'asc' as const } }, company: true } as const;
type Job = Prisma.JobGetPayload<{ include: typeof include; omit: { searchText: true } }>;
type Publication = Job['sources'][number];
type Body = { version: 1; kind: typeof KIND; revision: string; request: Request; beforeHash: string;
  companyId: string; sourceKeys: string[]; groups: Array<{ jobId: string; sourceIds: string[]; ownerId: string;
    outputHash: string; patch: Prisma.InputJsonValue; facts: Prisma.InputJsonValue; presentations: Array<{ sourceId: string; outputHash: string; cache: Prisma.InputJsonValue; facts: Prisma.InputJsonValue }>; lifecycle: 'KEEP' | 'CLOSE' | 'WITHDRAW' }>; redirects: Array<{ jobId: string; targetId: string }> };
export type GroupRepairPlan = Body & { planHash: string };

function validate(request: Request) {
  if (!request || !Array.isArray(request.jobIds) || !request.jobIds.length || request.jobIds.length > 50 ||
    new Set(request.jobIds).size !== request.jobIds.length || request.jobIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 200) ||
    !Array.isArray(request.groups) || !request.groups.length || request.groups.length > 200 ||
    request.groups.some(group => !group || typeof group.jobId !== 'string' || !group.jobId.trim() || group.jobId.length > 200 ||
      !Array.isArray(group.sourceIds) || !group.sourceIds.length || group.sourceIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 200)) ||
    new Set(request.groups.map(group => group.jobId)).size !== request.groups.length ||
    typeof request.reason !== 'string' || request.reason.trim().length < 10 || request.reason.length > 2000) {
    throw new Error('Explicit bounded publication groups and a review reason are required');
  }
  const ids = request.groups.flatMap(group => group.sourceIds);
  if (ids.length > 200 || new Set(ids).size !== ids.length) throw new Error('Each publication must occur exactly once; maximum 200');
}

function ownerOf(sources: Publication[], current?: Job, at = new Date()) {
  return selectApplySource(sources, current ?? {}, at) ?? [...sources].sort((a, b) =>
    SOURCE_PRIORITY.indexOf(a.sourceTier as SourceTier) - SOURCE_PRIORITY.indexOf(b.sourceTier as SourceTier) || a.id.localeCompare(b.id))[0];
}

/** A repair preserves every native publication and every old Job ID. The
 * request is a complete partition, never a collection of unchecked row edits. */
async function prepare(db: Database, request: Request, bodies: ReadonlyMap<string, Buffer>) {
  validate(request);
  // Measure uncompressed input before returning payloads to the application.
  // A count bound alone does not bound the memory used by large native bodies.
  const [size] = await db.$queryRaw<Array<{ sources: bigint; bytes: bigint }>>(Prisma.sql`
    WITH publications AS (SELECT s.* FROM "JobSource" s WHERE s."jobId" IN (${Prisma.join(request.jobIds)})),
    sizes AS (
      SELECT COALESCE(sum(octet_length((to_jsonb(j)-'searchText')::text)),0) AS bytes FROM "Job" j WHERE j.id IN (${Prisma.join(request.jobIds)})
      UNION ALL SELECT COALESCE(sum(octet_length(to_jsonb(s)::text)),0) FROM publications s
      UNION ALL SELECT COALESCE(sum(b."byteLength"),0) FROM publications s
        JOIN "SourceExtraction" e ON e.id=s."captureOutputId" JOIN "RawBlob" b ON b.hash=e."outputHash"
    ) SELECT (SELECT count(*) FROM publications) AS sources, sum(bytes)::bigint AS bytes FROM sizes`);
  if (Number(size.sources) > 200 || Number(size.bytes) > MAX_REPAIR_BYTES) throw new Error('Publication repair exceeds its 32 MB / 200 publication input budget');
  const jobs = await db.job.findMany({ where: { id: { in: request.jobIds } }, include, omit: { searchText: true }, orderBy: { id: 'asc' } });
  if (jobs.length !== request.jobIds.length) throw new Error('Requested Job is missing');
  if (new Set(jobs.map(job => job.companyId)).size !== 1 || jobs.some(job => job.company.mergedIntoId)) throw new Error('Publication repair requires one current reviewed employer');
  const sources = jobs.flatMap(job => job.sources), assigned = request.groups.flatMap(group => group.sourceIds).sort();
  if (!sources.length || evidenceHash(sources.map(source => source.id).sort()) !== evidenceHash(assigned)) throw new Error('Every current publication must be included exactly once');
  if (sources.some(source => !SOURCE_PRIORITY.includes(source.sourceTier as SourceTier))) throw new Error('Unknown publication priority');
  const keys = [...new Set(sources.map(source => source.sourceKey))].sort();
  const catalogue = await db.source.findMany({ where: { key: { in: keys } }, orderBy: { key: 'asc' } });
  if (catalogue.length !== keys.length || catalogue.some(source => !KIND_TO_ATS[source.kind])) throw new Error('Publication source is missing or unregistered');
  if (sources.some(source => source.isActive && catalogue.find(item => item.key === source.sourceKey)?.status === 'RETIRED')) throw new Error('Retired source still has active publications; repair its lifecycle first');
  const allIds = new Set(request.jobIds);
  for (const job of jobs) if (job.mergedIntoId && !allIds.has(job.mergedIntoId)) throw new Error('Include the complete redirect chain in the repair');
  const extraIds = request.groups.map(group => group.jobId).filter(id => !allIds.has(id));
  if (extraIds.length && await db.job.count({ where: { id: { in: extraIds } } })) throw new Error('New presentation ID already exists outside the repair');
  const occupations = await loadOccupationTaxonomy(db);
  const trustRows = await db.sourceFieldTrust.findMany({ select: { source: true, path: true, dimension: true, level: true },
    orderBy: [{ source: 'asc' }, { path: 'asc' }, { dimension: 'asc' }] });
  const trust = new Map(trustRows.map(row => [`${row.source} ${row.path} ${row.dimension}`, row.level]));
  const groups = [];
  for (const group of request.groups) {
    const members = group.sourceIds.map(id => sources.find(source => source.id === id)!);
    const current = jobs.find(job => job.id === group.jobId);
    const unchangedReviewedGroup = current && evidenceHash(current.sources.map(source => source.id).sort()) === evidenceHash([...group.sourceIds].sort()) &&
      await reviewedPublicationGroup(db, current.id, members);
    if (!provenPublicationGroup(members) && !unchangedReviewedGroup) throw new Error('Requested grouping lacks pairwise native identity evidence');
    if (current?.mergedIntoId && !members.some(member => member.sourceKey === current.canonicalSourceKey && member.externalId === current.canonicalExternalId) &&
      !await db.publicationIdentityDecision.count({ where: { fromJobId: current.id, sourceId: { in: group.sourceIds } } })) {
      throw new Error('Restoration lacks an original native publication anchor');
    }
    const origins = [...new Set(members.map(member => member.jobId))].map(id => jobs.find(job => job.id === id)!);
    if (new Set(origins.map(job => job.opportunityType).filter(Boolean)).size > 1) throw new Error('Conflicting opportunity types require review');
    const withdrawals = origins.map(job => ({ at: job.withdrawnAt, reason: job.withdrawalReason }));
    if (new Set(withdrawals.map(state => evidenceHash(state))).size !== 1) throw new Error('Different withdrawal states require a lifecycle review');
    const owner = ownerOf(members, current);
    const rebuilt = [];
    for (const member of members) {
      const source = catalogue.find(source => source.key === member.sourceKey)!;
      const { captured, batch, outputHash } = await readCapturedPublication(db, member, undefined, bodies);
      if (batch.sourceKind !== KIND_TO_ATS[source.kind]) throw new Error('Captured adapter type differs from the current catalogue');
      if (!captured.title?.trim() || captured.publicationHold || captured.publicationWithdrawnAt) throw new Error('Captured publication is incomplete, held or withdrawn');
      const facts = readSourceFacts(KIND_TO_ATS[source.kind], member.raw);
      const candidate = { ...toCandidate(hydrateCapturedJob(captured), { key: source.key, tier: member.sourceTier as SourceTier,
        company: origins[0].company.name }, origins[0].company.name, KIND_TO_ATS[source.kind] as AtsType, trust),
        captureBatchId: member.captureBatchId!, captureOutputId: member.captureOutputId!,
        ...projectSourceFacts(facts), sourceFacts: facts };
      const content = publicationJobContent(candidate, occupations);
      rebuilt.push({ sourceId: member.id, outputHash, content, facts, cache: publicationPresentation(candidate, content) });
    }
    const selected = rebuilt.find(item => item.sourceId === owner.id)!;
    const { raw: _raw, ...content } = selected.content;
    const { facts, outputHash } = selected;
    const presentations = rebuilt.map(({ sourceId, outputHash, cache, facts }) => ({ sourceId, outputHash, cache, facts: json(facts) }));
    const available = !!selectApplySource(members, current ?? {});
    const lifecycle: 'KEEP' | 'CLOSE' | 'WITHDRAW' = !available && !withdrawals[0].at && !current?.closedAt
      ? members.every(member => {
        const type = KIND_TO_ATS[catalogue.find(item => item.key === member.sourceKey)!.kind];
        const declared = declaredExpiry(type, member.raw)?.expiresAt;
        return declared && declared <= new Date() && declared.getTime() === member.expiresAt?.getTime();
      }) ? 'CLOSE' : 'WITHDRAW' : 'KEEP';
    const withdrawalReason = lifecycle === 'WITHDRAW'
      ? members.every(member => catalogue.find(item => item.key === member.sourceKey)?.status === 'RETIRED') ? 'SOURCE_RETIRED' : 'ATTESTATION_MISSING'
      : withdrawals[0].reason;
    const patch = { ...content, companyId: jobs[0].companyId, mergedIntoId: null,
      // Location enrichments formerly attached to the group are not evidence for this publication.
      inseeCode: null, adminArea2: null, validThrough: owner.expiresAt,
      isActive: available && !withdrawals[0].at, withdrawnAt: withdrawals[0].at, withdrawalReason,
      closedAt: available ? null : current?.closedAt ?? null,
      lastSeenAt: new Date(Math.max(...members.map(member => member.lastSeenAt.getTime()))),
    };
    groups.push({ jobId: group.jobId, sourceIds: [...group.sourceIds].sort(), ownerId: owner.id, outputHash, patch, facts, presentations, lifecycle });
  }
  const redirects: Body['redirects'] = [];
  for (const job of jobs) {
    if (request.groups.some(group => group.jobId === job.id) || job.mergedIntoId) continue;
    const targets = request.groups.filter(group => job.sources.some(source => group.sourceIds.includes(source.id)));
    if (targets.length !== 1) throw new Error('A divided historical Job ID must be preserved in one resulting group');
    redirects.push({ jobId: job.id, targetId: targets[0].jobId });
  }
  // Current reviewed decisions affect eligibility and must be part of the snapshot.
  const decisions = await db.publicationIdentityDecision.findMany({ where: { toJobId: { in: request.jobIds } },
    select: { id: true, evidence: true, action: true }, orderBy: { id: 'asc' } });
  const body: Body = { version: 1, kind: KIND, revision: captureReaderRevision(), request,
    beforeHash: evidenceHash({ jobs, catalogue, trustRows, occupationRelease: occupations.manifest, decisions }),
    companyId: jobs[0].companyId, sourceKeys: keys,
    groups: groups.map(group => ({ ...group, patch: json(group.patch), facts: json(group.facts) })), redirects };
  return { body, jobs, sources, groups };
}

async function prefetchBodies(db: Database, hashes: string[], store?: ObjectStore) {
  const unique = [...new Set(hashes)];
  if (unique.length > 200) throw new Error('Too many extraction bodies for one repair');
  const sizes = await db.rawBlob.aggregate({ where: { hash: { in: unique } }, _sum: { byteLength: true } });
  if ((sizes._sum.byteLength ?? 0) > MAX_REPAIR_BYTES) throw new Error('Publication repair exceeds its archive input budget');
  const bodies = new Map<string, Buffer>();
  for (const hash of unique) bodies.set(hash, await readRawBlob(db, hash, store));
  return bodies;
}

export async function planPublicationGroups(db: PrismaClient, input: GroupRepairRequest, store?: ObjectStore): Promise<GroupRepairPlan> {
  const request = { ...input, jobIds: [...input.jobIds].sort(), groups: input.groups.map(group => ({
    jobId: group.jobId ?? randomUUID(), sourceIds: [...group.sourceIds].sort(),
  })).sort((a, b) => a.jobId.localeCompare(b.jobId)) };
  validate(request);
  const outputs = await db.jobSource.findMany({ where: { jobId: { in: request.jobIds } }, take: 201,
    select: { captureOutput: { select: { outputHash: true } } } });
  if (outputs.length > 200) throw new Error('Too many publications for one repair');
  const bodies = await prefetchBodies(db, outputs.flatMap(source => source.captureOutput ? [source.captureOutput.outputHash] : []), store);
  const { body } = await db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return prepare(tx, request, bodies);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
  return { ...body, planHash: evidenceHash(body) };
}

export async function applyPublicationGroups(db: PrismaClient, plan: GroupRepairPlan, expectedHash: string, store?: ObjectStore) {
  const { planHash, ...body } = plan;
  validate(plan.request);
  if (planHash !== expectedHash || evidenceHash(body) !== planHash || plan.kind !== KIND || plan.version !== 1 ||
    plan.revision !== captureReaderRevision()) throw new Error('Invalid or obsolete publication repair plan');
  await db.maintenancePlan.createMany({ data: [{ id: planHash, kind: KIND, version: 1, revision: plan.revision, body: json(plan) }], skipDuplicates: true });
  const saved = await db.maintenancePlan.findUniqueOrThrow({ where: { id: planHash } });
  if (evidenceHash(saved.body) !== evidenceHash(plan)) throw new Error('Stored publication plan differs');
  const batchId = `publication-groups:${planHash}`;
  if (await db.dataCorrection.count({ where: { batchId, entityType: 'PublicationGroupPlan', entityId: planHash } })) return { planHash, alreadyApplied: true };
  const bodies = await prefetchBodies(db, plan.groups.flatMap(group => group.presentations.map(item => item.outputHash)), store);
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(async tx => {
    await lockEmployerCatalogue(tx);
    for (const key of plan.sourceKeys) await lockSourceWrites(tx, key);
    await lockCompanyRows(tx, [plan.companyId]);
    await lockOccupationTaxonomy(tx);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Job" WHERE id IN (${Prisma.join(plan.request.jobIds)}) ORDER BY id FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "JobSource" WHERE "jobId" IN (${Prisma.join(plan.request.jobIds)}) ORDER BY id FOR UPDATE`);
    if (await tx.dataCorrection.count({ where: { batchId, entityType: 'PublicationGroupPlan', entityId: planHash } })) return { planHash, alreadyApplied: true };
    const prepared = await prepare(tx, plan.request, bodies);
    if (evidenceHash(prepared.body) !== evidenceHash(body)) throw new Error('Publication repair input, evidence or availability changed');
    for (const group of prepared.groups) {
      const target = prepared.jobs.find(job => job.id === group.jobId);
      for (const id of group.sourceIds) {
        const source = prepared.sources.find(source => source.id === id)!;
        if (source.jobId === group.jobId) continue;
        await tx.publicationIdentityDecision.create({ data: { sourceId: id, fromJobId: source.jobId, toJobId: group.jobId,
          action: target?.mergedIntoId ? 'RESTORED' : group.sourceIds.length === 1 ? 'SEPARATED' : 'MOVED', readerVersion: plan.revision,
          evidence: json({ rule: 'REVIEWED_PUBLICATION_PARTITION', planHash, previousRedirect: target?.mergedIntoId ?? null,
            reason: plan.request.reason, subject: { id, rawHash: evidenceHash(source.raw), captureBatchId: source.captureBatchId, captureOutputId: source.captureOutputId },
            peers: group.sourceIds.filter(peer => peer !== id).map(peer => ({ sourceId: peer,
              proof: publicationIdentityProof(source, prepared.sources.find(item => item.id === peer)!) })) }) } });
      }
      const owner = prepared.sources.find(source => source.id === group.ownerId)!;
      const data = { ...group.patch, raw: owner.raw == null ? Prisma.DbNull : owner.raw as Prisma.InputJsonValue,
        ...(group.lifecycle === 'CLOSE' ? { closedAt: new Date() } : {}),
        ...(group.lifecycle === 'WITHDRAW' ? { withdrawnAt: new Date() } : {}),
      };
      const written = target ? await tx.job.update({ where: { id: group.jobId }, data }) : await tx.job.create({ data: {
        ...data, id: group.jobId, firstSeenAt: new Date(Math.min(...group.sourceIds.map(id => prepared.sources.find(source => source.id === id)!.firstSeenAt.getTime()))),
      } });
      await recordOccupationObservation(tx, written, target ?? null);
      if (group.lifecycle !== 'KEEP') await tx.jobEvent.create({ data: { jobId: group.jobId,
        type: group.lifecycle === 'CLOSE' ? 'CLOSED' : 'WITHDRAWN', at: group.lifecycle === 'CLOSE' ? written.closedAt! : written.withdrawnAt!,
        after: group.lifecycle === 'WITHDRAW' ? group.patch.withdrawalReason : null } });
      await tx.jobSource.updateMany({ where: { id: { in: group.sourceIds } }, data: { jobId: group.jobId } });
      for (const item of group.presentations) await tx.jobSource.update({ where: { id: item.sourceId }, data: { sourceFacts: item.facts, presentation: item.cache } });
    }
    for (const redirect of prepared.body.redirects) {
      await tx.job.update({ where: { id: redirect.jobId }, data: { isActive: false, mergedIntoId: redirect.targetId,
        events: { create: { type: 'MERGED', field: 'mergedInto', after: redirect.targetId } } } });
    }
    const after = await tx.job.findMany({ where: { id: { in: [...new Set([...plan.request.jobIds, ...plan.groups.map(group => group.jobId)])] } },
      include, omit: { searchText: true }, orderBy: { id: 'asc' } });
    await tx.dataCorrection.create({ data: { batchId, planHash, commitHash: plan.revision, finding: 'REVIEWED_PUBLICATION_PARTITION',
      entityType: 'PublicationGroupPlan', entityId: planHash, before: json(prepared.jobs), after: json(after),
      evidence: json({ reason: plan.request.reason, outputs: plan.groups.map(group => ({ ownerId: group.ownerId, outputHash: group.outputHash })) }) } });
    return { planHash, alreadyApplied: false, groups: plan.groups.length, redirects: plan.redirects.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' ||
        error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code)));
      if (attempt >= 2 || !retryable) throw error;
    }
  }
}

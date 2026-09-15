import { recoverRetainedPublication } from '../publication/recovery.js';
import { publicationPresentation } from '../publication/presentation.js';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AtsType } from '@prisma/client';
import { loadOccupationTaxonomy, lockOccupationTaxonomy } from '@catwalks/db/occupations';
import { selectApplySource, SOURCE_PRIORITY, type SourceTier } from '@catwalks/db/publications';
import { KIND_TO_ATS } from '../ats/catalogKinds.js';
import { readCapturedPublication } from '../capture/publication.js';
import { captureReaderRevision } from '../capture/revision.js';
import { readRawBlob } from '../capture/store.js';
import type { ObjectStore } from '../retention/objectStore.js';
import { toCandidate } from '../pipeline/ingest.js';
import { publicationJobContent } from '../publication/content.js';
import { readSourceFacts, projectSourceFacts } from '../facts/index.js';
import { recordOccupationObservation } from '../occupation/persist.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { storeMaintenancePlan, recordDataCorrection } from '../lib/maintenancePlan.js';
import { lockCompanyRows, lockEmployerCatalogue, lockSourceWrites } from '../lib/writeLocks.js';
import { provenPublicationGroup, publicationIdentityProof } from './match.js';
import { reviewedPublicationGroup } from './decisions.js';
import { declaredExpiry } from '../normalize/expiry.js';

const KIND = 'PUBLICATION_GROUP_REPAIR';
const MAX_REPAIR_BYTES = 32_000_000;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type Database = Prisma.TransactionClient;
type Group = { jobId: string; sourceIds: string[] };
export type GroupRepairRequest = { jobIds: string[]; groups: Array<{ jobId?: string; sourceIds: string[] }>; quarantineSourceIds?: string[]; withdrawJobIds?: string[]; reason: string };
type Request = { jobIds: string[]; groups: Group[]; quarantineSourceIds: string[]; withdrawJobIds: string[]; reason: string };
const include = { sources: { orderBy: { id: 'asc' as const } }, company: true } as const;
type Job = Prisma.JobGetPayload<{ include: typeof include; omit: { searchText: true } }>;
type Publication = Job['sources'][number];
type InputProof = { rawHash: string; sourceLastSeenAt: string } &
  ({ origin: 'RETAINED_RAW' } | { origin: 'NATIVE_CAPTURE'; captureOutputHash: string });
type Body = { version: 5; kind: typeof KIND; revision: string; request: Request; beforeHash: string;
  companyId: string; sourceKeys: string[]; quarantines: Array<{ sourceId: string; reason: string; rawHash: string }>; groups: Array<{ jobId: string; sourceIds: string[]; ownerId: string;
    outputHash: string; patch: Prisma.InputJsonValue; facts: Prisma.InputJsonValue; presentations: Array<{ sourceId: string; outputHash: string; proof: InputProof; cache: Prisma.InputJsonValue; facts: Prisma.InputJsonValue }>; lifecycle: 'KEEP' | 'CLOSE' | 'WITHDRAW' }>; redirects: Array<{ jobId: string; targetId: string }> };
export type GroupRepairPlan = Body & { planHash: string };

function validate(request: Request) {
  if (!request || !Array.isArray(request.jobIds) || !request.jobIds.length || request.jobIds.length > 50 ||
    new Set(request.jobIds).size !== request.jobIds.length || request.jobIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 200) ||
    !Array.isArray(request.groups) || (!request.groups.length && !request.withdrawJobIds?.length) || request.groups.length > 200 ||
    request.groups.some(group => !group || typeof group.jobId !== 'string' || !group.jobId.trim() || group.jobId.length > 200 ||
      !Array.isArray(group.sourceIds) || !group.sourceIds.length || group.sourceIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 200)) ||
    new Set(request.groups.map(group => group.jobId)).size !== request.groups.length ||
    typeof request.reason !== 'string' || request.reason.trim().length < 10 || request.reason.length > 2000) {
    throw new Error('Explicit bounded publication groups and a review reason are required');
  }
  if (!Array.isArray(request.quarantineSourceIds) || request.quarantineSourceIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 200)) throw new Error('Explicit quarantine publication IDs required');
  if (!Array.isArray(request.withdrawJobIds) || new Set(request.withdrawJobIds).size !== request.withdrawJobIds.length ||
    request.withdrawJobIds.some(id => !request.jobIds.includes(id) || request.groups.some(group => group.jobId === id))) {
    throw new Error('Withdrawn historical IDs must belong to the review and cannot be reused by a resulting group');
  }
  const ids = [...request.groups.flatMap(group => group.sourceIds), ...request.quarantineSourceIds];
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
  const sources = jobs.flatMap(job => job.sources), assigned = [...request.groups.flatMap(group => group.sourceIds), ...request.quarantineSourceIds].sort();
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
  const anchored = (member: Publication, job: Job) => member.jobId === job.id &&
    (job.canonicalSourceKey && job.canonicalExternalId
      ? member.sourceKey === job.canonicalSourceKey && member.externalId === job.canonicalExternalId
      : member.url === job.url);
  for (const jobId of request.withdrawJobIds) {
    const job = jobs.find(job => job.id === jobId)!;
    if (job.closedAt) throw new Error('A proven closure must retain its lifecycle; historical withdrawal requires separate review');
    if (job.mergedIntoId || !job.sources.some(member => anchored(member, job) && request.quarantineSourceIds.includes(member.id))) {
      throw new Error('Historical withdrawal requires its own unqualified publication anchor and no existing redirect');
    }
  }
  const quarantines: Body['quarantines'] = [];
  for (const sourceId of request.quarantineSourceIds) {
    const member = sources.find(source => source.id === sourceId)!;
    // Retain the old public ID on a qualified remaining member. Quarantine
    // alone cannot authorize a guessed redirect or an invented presentation.
    if (!request.withdrawJobIds.includes(member.jobId!) && !request.groups.some(group => group.jobId === member.jobId && group.sourceIds.some(id => sources.find(source => source.id === id)?.jobId === member.jobId))) {
      throw new Error('Quarantine requires a qualified remaining publication on the original Job ID');
    }
    const original = jobs.find(job => job.id === member.jobId)!;
    const remaining = request.groups.find(group => group.jobId === member.jobId);
    if (!request.withdrawJobIds.includes(original.id) && !remaining?.sourceIds.some(id => anchored(sources.find(source => source.id === id)!, original))) {
      throw new Error('Quarantine cannot replace the original public application identity without review');
    }
    const source = catalogue.find(source => source.key === member.sourceKey)!;
    const recovered = recoverRetainedPublication(source.kind, member.raw, { externalId: member.externalId,
      url: member.url, observedAt: member.lastSeenAt, config: source.config as Record<string, unknown> });
    if (recovered.status === 'RECOVERABLE') throw new Error('Recoverable publication must be rebuilt or separated, not quarantined');
    quarantines.push({ sourceId, reason: recovered.reason, rawHash: evidenceHash(member.raw) });
  }
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
      let provenance: { origin: 'RETAINED_RAW' } | { origin: 'NATIVE_CAPTURE'; captureOutputHash: string } = { origin: 'RETAINED_RAW' };
      if (member.captureBatchId || member.captureOutputId) {
        const result = await readCapturedPublication(db, member, undefined, bodies);
        if (result.batch.sourceKind !== KIND_TO_ATS[source.kind]) throw new Error('Captured adapter type differs from the current catalogue');
        if (result.captured.publicationHold || result.captured.publicationWithdrawnAt) throw new Error('Captured publication is held or withdrawn');
        provenance = { origin: 'NATIVE_CAPTURE', captureOutputHash: result.outputHash };
      }
      // Archiving a reader's output proves its provenance, not its correctness.
      // Rebuild from its own RAW with today's qualified reader in both cases.
      const recovered = recoverRetainedPublication(source.kind, member.raw, { externalId: member.externalId, url: member.url,
        observedAt: member.lastSeenAt, config: source.config as Record<string, unknown> });
      if (recovered.status !== 'RECOVERABLE') throw new Error(`PUBLICATION_RECOVERY_REQUIRED source=${source.key} id=${member.externalId} reason=${recovered.reason}`);
      const captured = recovered.job, outputHash = recovered.outputHash;
      const proof: InputProof = { ...provenance, rawHash: recovered.rawHash, sourceLastSeenAt: member.lastSeenAt.toISOString() };
      const facts = readSourceFacts(KIND_TO_ATS[source.kind], member.raw);
      const candidate = { ...toCandidate(captured, { key: source.key, tier: member.sourceTier as SourceTier,
        company: origins[0].company.name }, origins[0].company.name, KIND_TO_ATS[source.kind] as AtsType, trust),
        captureBatchId: member.captureBatchId ?? undefined, captureOutputId: member.captureOutputId ?? undefined,
        ...projectSourceFacts(facts), sourceFacts: facts };
      const content = publicationJobContent(candidate, occupations);
      rebuilt.push({ sourceId: member.id, outputHash, proof, content, facts, cache: publicationPresentation(candidate, content) });
    }
    const selected = rebuilt.find(item => item.sourceId === owner.id)!;
    const { raw: _raw, ...content } = selected.content;
    const { facts, outputHash } = selected;
    const presentations = rebuilt.map(({ sourceId, outputHash, proof, cache, facts }) => ({ sourceId, outputHash, proof, cache, facts: json(facts) }));
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
    if (request.groups.some(group => group.jobId === job.id) || request.withdrawJobIds.includes(job.id) || job.mergedIntoId) continue;
    const targets = request.groups.filter(group => job.sources.some(source => group.sourceIds.includes(source.id)));
    if (targets.length !== 1) throw new Error('A divided historical Job ID must be preserved in one resulting group');
    redirects.push({ jobId: job.id, targetId: targets[0].jobId });
  }
  // Current reviewed decisions affect eligibility and must be part of the snapshot.
  const decisions = await db.publicationIdentityDecision.findMany({ where: { toJobId: { in: request.jobIds } },
    select: { id: true, evidence: true, action: true }, orderBy: { id: 'asc' } });
  const body: Body = { version: 5, kind: KIND, revision: captureReaderRevision(), request,
    beforeHash: evidenceHash({ jobs, catalogue, trustRows, occupationRelease: occupations.manifest, decisions }),
    companyId: jobs[0].companyId, sourceKeys: keys, quarantines,
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
  const request = { ...input, withdrawJobIds: [...input.withdrawJobIds ?? []].sort(), quarantineSourceIds: [...input.quarantineSourceIds ?? []].sort(), jobIds: [...input.jobIds].sort(), groups: input.groups.map(group => ({
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
  if (planHash !== expectedHash || evidenceHash(body) !== planHash || plan.kind !== KIND || plan.version !== 5 ||
    plan.revision !== captureReaderRevision()) throw new Error('Invalid or obsolete publication repair plan');
  await storeMaintenancePlan(db, { id: planHash, kind: KIND, version: 5, revision: plan.revision, body: plan });
  const batchId = `publication-groups:${planHash}`;
  if (await db.dataCorrection.count({ where: { batchId, entityType: 'PublicationGroupPlan', entityId: planHash } })) return { planHash, alreadyApplied: true };
  let bodies: Map<string, Buffer>;
  try {
    bodies = await prefetchBodies(db, plan.groups.flatMap(group => group.presentations.flatMap(item => item.proof.origin === 'NATIVE_CAPTURE' ? [item.proof.captureOutputHash] : [])), store);
  } catch (error) {
    // Another worker may have committed while this cold read was in flight.
    if (await db.dataCorrection.count({ where: { batchId, entityType: 'PublicationGroupPlan', entityId: planHash } })) return { planHash, alreadyApplied: true };
    throw error;
  }
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
    for (const item of prepared.body.quarantines) {
      const source = prepared.sources.find(source => source.id === item.sourceId)!;
      await tx.publicationIdentityDecision.create({ data: { sourceId: source.id, fromJobId: source.jobId,
        toJobId: null, action: 'QUARANTINED', readerVersion: plan.revision, evidence: {
          rule: 'REVIEWED_PUBLICATION_PARTITION', planHash, reason: plan.request.reason,
          quarantineReason: item.reason, rawHash: item.rawHash,
          captureBatchId: source.captureBatchId, captureOutputId: source.captureOutputId,
        } } });
      await tx.jobSource.update({ where: { id: source.id }, data: { jobId: null,
        quarantinedAt: new Date(), quarantineReason: item.reason, presentation: Prisma.DbNull } });
    }
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
      const { latitude, longitude, employmentEvidence, ...patch } = group.patch;
      const data = { ...patch,
        ...(group.lifecycle === 'CLOSE' ? { closedAt: new Date() } : {}),
        ...(group.lifecycle === 'WITHDRAW' ? { withdrawnAt: new Date() } : {}),
      };
      const written = target ? await tx.job.update({ where: { id: group.jobId }, data }) : await tx.job.create({ data: {
        ...data, id: group.jobId, firstSeenAt: new Date(Math.min(...group.sourceIds.map(id => prepared.sources.find(source => source.id === id)!.firstSeenAt.getTime()))),
      } });
      // Copy the retained RAW inside PostgreSQL; JSON input conversion must not round it.
      await tx.$executeRaw`UPDATE "Job" SET raw=(SELECT raw FROM "JobSource" WHERE id=${owner.id}),
        latitude=${latitude == null ? null : String(latitude)}::double precision,
        longitude=${longitude == null ? null : String(longitude)}::double precision,
        "employmentEvidence"=${employmentEvidence == null || employmentEvidence === Prisma.DbNull ? null : JSON.stringify(employmentEvidence)}::jsonb
        WHERE id=${written.id}`;
      await recordOccupationObservation(tx, written, target ?? null);
      if (group.lifecycle !== 'KEEP') await tx.jobEvent.create({ data: { jobId: group.jobId,
        type: group.lifecycle === 'CLOSE' ? 'CLOSED' : 'WITHDRAWN', at: group.lifecycle === 'CLOSE' ? written.closedAt! : written.withdrawnAt!,
        after: group.lifecycle === 'WITHDRAW' ? group.patch.withdrawalReason : null } });
      await tx.jobSource.updateMany({ where: { id: { in: group.sourceIds } }, data: { jobId: group.jobId } });
      for (const item of group.presentations) await tx.$executeRaw`UPDATE "JobSource"
        SET "sourceFacts"=${JSON.stringify(item.facts)}::jsonb, presentation=${JSON.stringify(item.cache)}::jsonb
        WHERE id=${item.sourceId}`;
    }
    for (const jobId of plan.request.withdrawJobIds) {
      const previous = prepared.jobs.find(job => job.id === jobId)!;
      // Preserve historical content for audit only. The
      // public contract exposes this ID as withdrawn without unqualified text.
      const at = previous.withdrawnAt ?? new Date();
      await tx.job.update({ where: { id: jobId }, data: { isActive: false,
        withdrawnAt: at, withdrawalReason: 'PUBLICATION_UNVERIFIED' } });
      if (!previous.withdrawnAt) await tx.jobEvent.create({ data: { jobId, type: 'WITHDRAWN', at, after: 'PUBLICATION_UNVERIFIED' } });
    }
    for (const redirect of prepared.body.redirects) {
      await tx.job.update({ where: { id: redirect.jobId }, data: { isActive: false, mergedIntoId: redirect.targetId,
        events: { create: { type: 'MERGED', field: 'mergedInto', after: redirect.targetId } } } });
    }
    const after = await tx.job.findMany({ where: { id: { in: [...new Set([...plan.request.jobIds, ...plan.groups.map(group => group.jobId)])] } },
      include, omit: { searchText: true }, orderBy: { id: 'asc' } });
    const quarantined = await tx.jobSource.findMany({ where: { id: { in: plan.request.quarantineSourceIds } }, orderBy: { id: 'asc' } });
    await recordDataCorrection(tx, { id: randomUUID(), batchId, planHash, commitHash: plan.revision, finding: 'REVIEWED_PUBLICATION_PARTITION',
      entityType: 'PublicationGroupPlan', entityId: planHash, before: json(prepared.jobs), after: json(after),
      evidence: json({ reason: plan.request.reason, quarantined, outputs: plan.groups.flatMap(group => group.presentations.map(({ sourceId, outputHash, proof }) => ({ sourceId, outputHash, ...proof }))) }) });
    return { planHash, alreadyApplied: false, groups: plan.groups.length, redirects: plan.redirects.length, quarantined: plan.quarantines.length, withdrawn: plan.request.withdrawJobIds.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' ||
        error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code)));
      if (attempt >= 2 || !retryable) throw error;
    }
  }
}

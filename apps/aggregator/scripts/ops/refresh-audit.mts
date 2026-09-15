/** Audit the immutable transaction ledger, never infer writes from present-day inactivity. */
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { compareTouched, verifyManifest, type RefreshManifest } from '../../src/pipeline/refreshManifest.js';

const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!arg('manifest')) throw new Error('refresh-audit.mts --manifest=file [--out=file]');
const manifest = JSON.parse(readFileSync(arg('manifest')!, 'utf8')) as RefreshManifest;
const check = verifyManifest(manifest);
if (!check.valid) throw new Error(check.problems.join('; '));
const db = new PrismaClient({ log: [] });
try {
  const rows = await db.dataCorrection.findMany({ where: { batchId: `refresh:${manifest.planHash}` } });
  const key = (type: string, id: string) => JSON.stringify([type, id]);
  const expectedEntities = new Set(manifest.entries.map(entry => entry.jobId ? key('Job', entry.jobId) : key('JobSource', entry.jobSourceId)));
  const problems: string[] = [], touched: string[] = [], skipped: { entityType: string; entityId: string; reason: string }[] = [];
  const appliedJobs = new Set<string>();
  for (const row of rows) {
    if (!expectedEntities.has(key(row.entityType, row.entityId)) || row.planHash !== manifest.planHash || row.finding !== 'REFRESH_LIFECYCLE') {
      problems.push(`Unexpected ledger entry: ${row.id}`); continue;
    }
    const before = row.before as { isActive?: boolean; sources?: { id: string; isActive: boolean }[] };
    const after = row.after as { isActive?: boolean; closedAt?: string | null; withdrawnAt?: string | null; sources?: { id: string; isActive: boolean }[] };
    const evidence = row.evidence as { outcome?: string; deactivatedIds?: string[] };
    const actual = row.entityType === 'JobSource' ? (before.isActive && after.isActive === false ? [row.entityId] : []) : (before.sources ?? []).filter(source => source.isActive && after.sources?.some(s => s.id === source.id && !s.isActive)).map(source => source.id);
    touched.push(...actual);
    if (JSON.stringify([...actual].sort()) !== JSON.stringify([...(evidence.deactivatedIds ?? [])].sort())) problems.push(`Source audit mismatch: ${row.entityId}`);
    if (evidence.outcome === 'APPLIED') {
      if (row.entityType === 'Job') appliedJobs.add(row.entityId);
      const expected = manifest.entries.filter(entry => row.entityType === 'Job' ? entry.jobId === row.entityId : entry.jobId === null && entry.jobSourceId === row.entityId);
      for (const entry of expected) {
        if (!actual.includes(entry.jobSourceId)) problems.push(`Planned deactivation missing: ${entry.jobSourceId}`);
        if (entry.consequence === 'JOB_CANDIDATE_FOR_CLOSURE' && (after.isActive !== false || !after.closedAt)) problems.push(`Closure mismatch: ${row.entityId}`);
        if (entry.consequence === 'JOB_KEPT_BY_ANOTHER_SOURCE' && after.isActive !== true) problems.push(`Survival mismatch: ${row.entityId}`);
      }
    } else if (['BEFORE_STATE_CHANGED', 'EVIDENCE_CHANGED', 'OUTCOME_CHANGED', 'MISSING_OR_OUTSIDE_SCOPE', 'UNCHANGED'].includes(evidence.outcome ?? '')) {
      if (actual.length) problems.push(`Skipped operation changed sources: ${row.entityId}`);
      skipped.push({ entityType: row.entityType, entityId: row.entityId, reason: evidence.outcome! });
    } else problems.push(`Unknown operation outcome: ${row.entityId}`);
    if (row.entityType === 'Job' && after.isActive && (after.closedAt || after.withdrawnAt)) problems.push(`Contradictory lifecycle state: ${row.entityId}`);
  }
  const parity = compareTouched(manifest, touched);
  if (parity.unexpected.length) problems.push(`Sources changed outside manifest: ${parity.unexpected.join(', ')}`);
  const seen = new Set(rows.map(row => key(row.entityType, row.entityId)));
  for (const entity of expectedEntities) if (!seen.has(entity)) problems.push(`No completed or skipped transaction: ${entity}`);
  const audit = { at: new Date(), planHash: manifest.planHash, manifestEntries: manifest.entries.length,
    touched: touched.length, appliedJobs: appliedJobs.size, skipped, parity, problems };
  const output = JSON.stringify(audit, null, 2);
  if (arg('out')) writeFileSync(arg('out')!, output + '\n');
  console.log(output);
  if (problems.length) process.exitCode = 1;
} finally { await db.$disconnect(); }

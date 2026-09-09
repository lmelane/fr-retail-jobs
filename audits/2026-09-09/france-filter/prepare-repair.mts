/** Freeze the two measured flag corrections. Does not infer or change geography. */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { digest, json, type RepairPlan } from '../../../apps/aggregator/src/remediation/plan.js';
const out = process.argv.find(a => a.startsWith('--out='))?.slice(6);
if (!out) throw new Error('--out required');
mkdirSync(out, { recursive: true });
const ids = ['cmtp1wbd102dxqq4z33d3co5a', 'cmtp1wbdb02e1qq4zqbedsx3e'];
const db = new PrismaClient();
try {
  const manifest = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const jobs = await tx.job.findMany({ where: { id: { in: ids } }, omit: { searchText: true }, orderBy: { id: 'asc' } });
    const sources = await tx.jobSource.findMany({ where: { jobId: { in: ids } }, orderBy: { id: 'asc' } });
    const history = await tx.jobEvent.findMany({ where: { jobId: { in: ids } }, orderBy: { id: 'asc' } });
    if (jobs.length !== ids.length || jobs.some(j => !j.isActive || j.countryCode !== 'FR' || j.isFrance || j.canonicalSourceKey !== 'vestiaire-collective')) throw new Error('Reviewed cohort changed; measure again');
    const batchId = '20260909-FRANCE-DERIVED-FLAG-v1';
    const evidence = { rule: 'isFrance = (retained canonical countryCode === FR)', geographyUnchanged: true, measuredIds: ids, sourceSnapshotHash: digest(sources), historySnapshotHash: digest(history) };
    const plan: RepairPlan = {
      version: 1, batchId, finding: 'France filter flag contradicts retained canonical country', createdAt: new Date().toISOString(),
      sourceKeys: [...new Set(sources.map(s => s.sourceKey))].sort(), companyIds: [...new Set(jobs.map(j => j.companyId))].sort(),
      operations: jobs.map(j => ({ entity: 'Job', id: j.id, before: json(j), patch: { isFrance: true }, reason: 'Repair derived flag only; countryCode FR already retained. City-only reattestation previously skipped flag maintenance.' })),
      evidence, invariants: ['france-filter', 'lifecycle', 'oracle'],
    };
    const path = `${out}/${batchId}.json`;
    writeFileSync(path, JSON.stringify(plan, null, 2) + '\n', { mode: 0o600 });
    return { at: new Date().toISOString(), evidenceHash: digest(evidence), plans: [{ batchId, path, hash: digest(plan), jobs: jobs.length, operations: plan.operations.length }], snapshots: [{ batchId, jobs: json(jobs), sources: json(sources), history: json(history) }] };
  }, { timeout: 30000 });
  writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ ...manifest, snapshots: undefined }, null, 2));
} finally { await db.$disconnect(); }

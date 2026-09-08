import type { PrismaClient } from '@prisma/client';
import { json, type RepairPlan, type Operation } from './plan.js';

export type ExcludedIdentity = { key: string; kind: string; configField: string; tenant: string; name: string; canonicalKey: string; proof: string };
const originalDefinitions: ExcludedIdentity[] = [
    { key: 'via', kind: 'greenhouse', configField: 'board', tenant: 'via', name: 'Via (mobilité)', canonicalKey: 'VIA_MOBILITY', proof: 'https://job-boards.greenhouse.io/via/jobs/8700271002' },
    { key: 'ashoka', kind: 'lever', configField: 'site', tenant: 'ashoka', name: 'Ashoka (entrepreneuriat social)', canonicalKey: 'ASHOKA_SOCIAL', proof: 'https://jobs.lever.co/ashoka/45d1d066-b9e7-4452-9733-dbe4faf90ba5' },
];

/** Retire the proven unrelated tenants without deleting postings or their history. */
export async function planExcludedIdentities(prisma: PrismaClient, definitions = originalDefinitions, batchId = '20260908-P0-EMPLOYERS-v1'): Promise<RepairPlan> {
  if (!definitions.length || new Set(definitions.map(d => d.key)).size !== definitions.length) throw new Error('Empty or duplicate reviewed employer definitions');
  const operations: Operation[] = []; const companyIds = new Set<string>(); const at = new Date().toISOString();
  for (const definition of definitions) {
    const source = await prisma.source.findUniqueOrThrow({ where: { key: definition.key } });
    if (source.kind !== definition.kind || (source.config as Record<string, unknown>)[definition.configField] !== definition.tenant) throw new Error(`Employer tenant evidence changed: ${source.key}`);
    operations.push({ entity: 'Source', id: source.id, before: json(source), patch: {
      status: 'RETIRED', maison: definition.name,
      note: [source.note, `2026-09-08 P0: unrelated employer homonym. Evidence: ${definition.proof}. Retired with all histories preserved.`].filter(Boolean).join('\n'),
    }, reason: definition.proof });
    const entries = await prisma.jobSource.findMany({ where: { sourceKey: source.key }, include: { job: { include: { sources: true, company: true }, omit: { searchText: true } } } });
    const handledJobs = new Set<string>();
    for (const entry of entries) {
      const { job, ...before } = entry;
      if (entry.isActive) operations.push({ entity: 'JobSource', id: entry.id, before: json(before), patch: { isActive: false }, reason: 'Exclude the unrelated source from the sector; no employer closure inferred' });
      if (handledJobs.has(job.id)) continue;
      handledJobs.add(job.id);
      if (job.sources.some(s => s.sourceKey !== source.key && s.isActive)) throw new Error(`Other active employer evidence needs review: ${job.id}`);
      const { sources: _sources, company, ...jobBefore } = job;
      if (job.isActive) operations.push({ entity: 'Job', id: job.id, before: json(jobBefore), patch: { isActive: false, closedAt: at }, reason: 'Excluded from the sector catalogue; correction event, not employer CLOSED event' });
      if (!companyIds.has(company.id)) {
        const foreignJob = await prisma.job.findFirst({ where: { companyId: company.id, isActive: true, id: { notIn: entries.map(e => e.jobId) } }, select: { id: true } });
        if (foreignJob) throw new Error(`Employer identity also owns an unreviewed active job: ${company.id}/${foreignJob.id}`);
        companyIds.add(company.id);
        operations.push({ entity: 'Company', id: company.id, before: json(company), patch: {
          name: definition.name, canonicalKey: definition.canonicalKey, fashionjobsUrl: `resolved:${definition.canonicalKey}`,
          kind: 'OTHER', sector: 'OTHER', parentGroup: null, domain: null, domainSource: 'identity-homonym-correction',
          careersUrl: definition.proof.replace(/\/(?:jobs\/)?[a-f0-9-]+$/, ''),
          discoveryNote: `Previous sector brand identity contradicted by official employer: ${definition.proof}`,
        }, reason: 'Do not retain the unrelated fashion brand domain or canonical key on this employer' });
      }
    }
  }
  return { version: 1, batchId, finding: 'P0_EMPLOYER_HOMONYMS', createdAt: at,
    sourceKeys: definitions.map(d => d.key), companyIds: [...companyIds], operations,
    evidence: { officialEmployerEvidence: definitions.map(d => ({ sourceKey: d.key, url: d.proof })), preserve: 'No deletion, no fabricated employer closure; before/after snapshots and CORRECTED events' },
    invariants: ['oracle', 'lifecycle', 'smcp', 'excluded-identities'],
    excludedSourceKeys: definitions.map(d => d.key),
  };
}

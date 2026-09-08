import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { resolveCompany } from '../normalize/company.js';
import { classifySector, sectorForSource } from '../normalize/sector.js';
import { findMaison } from '../normalize/maisons.js';
import { blockingKey } from '../dedup/match.js';
import { leverEmployer, type LeverJob } from '../ats/adapters/lever.js';
import { json, type RepairPlan, type Operation } from './plan.js';

const farfetchDepartments = Object.fromEntries([
  ...['Operations','Technology','Business Services','Creative Operations','Commercial','Legal','Growth Marketing'].map(d => [`Farfetch - ${d}`, 'Farfetch']),
  ['Luxclusif', 'Luxclusif'], ['Stadium Goods - Operations', 'Stadium Goods'], ['Stadium Goods - Commercial', 'Stadium Goods'],
  ['Browns - Merchandising', 'Browns'], ['Browns - Retail', 'Browns'],
]);
const definitions = [
  { key: 'parfums-chanel', label: 'Chanel', tenant: 'ChanelCareers', configField: 'site', expected: 'Chanel', proof: 'https://www.chanel.com/fr/carrieres/' },
  { key: 'l-oreal-professionnel', label: "L'Oréal (toutes Maisons)", tenant: 'https://careers.loreal.com', configField: 'origin', expected: "L'Oréal", proof: 'https://www.loreal.com/en/careers/' },
  { key: 'lovisa', label: 'Lovisa', tenant: 'https://careers.lovisa.com', configField: 'origin', expected: 'Lovisa', proof: 'https://careers.lovisa.com/' },
  { key: 'browns', label: 'Farfetch (portail multi-enseignes)', tenant: 'farfetch', configField: 'site', expected: 'Farfetch', proof: 'https://jobs.lever.co/farfetch' },
];

/** Correct source ownership and explicit brand assignments, retaining every posting. */
export async function planSourceOwners(prisma: PrismaClient): Promise<RepairPlan> {
  const operations: Operation[] = []; const companyIds = new Set<string>(); const reviewedCompanies = new Map<string, string>();
  const evidence: unknown[] = [];
  for (const d of definitions) {
    const source = await prisma.source.findUniqueOrThrow({ where: { key: d.key } });
    const config = source.config as Record<string, unknown>;
    if (config[d.configField] !== d.tenant) throw new Error(`Source owner evidence no longer matches ${d.key}`);
    const patch = { maison: d.label, ...(d.key === 'browns' ? { config: { ...config, employerByDepartment: farfetchDepartments } } : {}) };
    if (source.maison !== d.label || d.key === 'browns') operations.push({ entity: 'Source', id: source.id, before: json(source), patch, reason: d.proof });
    const entries = await prisma.jobSource.findMany({ where: { sourceKey: d.key, isActive: true, job: { isActive: true } }, include: { job: { omit: { searchText: true } } } });
    if (new Set(entries.map(e => e.jobId)).size !== entries.length) throw new Error(`Several posting identities attached to one Job in ${d.key}`);
    const assignments: Record<string, number> = {};
    for (const entry of entries) {
      const raw = (entry.raw ?? {}) as LeverJob;
      const explicit = d.key === 'browns' ? leverEmployer(raw, farfetchDepartments) : undefined;
      if (d.key === 'browns' && raw.categories?.department && !explicit) throw new Error(`Unreviewed department: ${raw.categories.department}`);
      const name = explicit ?? d.expected; const identity = resolveCompany(name);
      assignments[identity.displayName] = (assignments[identity.displayName] ?? 0) + 1;
      let companyId = reviewedCompanies.get(identity.companyId);
      if (!companyId) {
        const company = await prisma.company.findUnique({ where: { fashionjobsUrl: `resolved:${identity.companyId}` } });
        companyId = company?.id ?? `cr${createHash('sha256').update(`OWNER:${identity.companyId}`).digest('hex').slice(0,24)}`;
        const sector = classifySector({ company: name, title: '', fromCatalogue: true, sourceSector: sectorForSource(d.key) }).sector;
        const companyPatch = {
          name: identity.displayName, canonicalKey: identity.companyId,
          kind: name === "L'Oréal" ? 'GROUP' : name === 'Chanel' ? 'MAISON' : 'RETAILER', sector,
          // Sharing a recruitment portal alone never establishes corporate ownership.
          parentGroup: findMaison(name)?.group || identity.group || company?.parentGroup || null,
        };
        if (!company || Object.entries(companyPatch).some(([key,value]) => (company as unknown as Record<string,unknown>)[key] !== value)) operations.push({ entity: 'Company', id: companyId, before: json(company), patch: company ? companyPatch : { ...companyPatch, fashionjobsUrl: `resolved:${identity.companyId}` }, reason: d.proof });
        reviewedCompanies.set(identity.companyId, companyId);
      }
      companyIds.add(companyId); companyIds.add(entry.job.companyId);
      if (entry.job.companyId === companyId) continue;
      if (entry.job.url !== entry.url) throw new Error(`Different canonical source needs review: ${entry.jobId}`);
      const clusterKey = blockingKey({ company: identity.displayName, title: entry.job.title, city: entry.job.city ?? undefined, location: entry.job.location ?? undefined, externalId: entry.externalId, sourceKey: entry.sourceKey, sourceTier: 'EMPLOYER_DIRECT', url: entry.url });
      operations.push({ entity: 'Job', id: entry.jobId, before: json(entry.job), patch: { companyId, clusterKey, fingerprint: `${clusterKey}|${entry.job.title}` }, reason: explicit ? `RAW categories.department=${raw.categories?.department}; ${d.proof}` : `Proven portal owner / canonical name; ${d.proof}` });
    }
    evidence.push({ sourceKey: d.key, proof: d.proof, entries: entries.length, assignments });
  }
  return { version: 1, batchId: '20260908-P0-SOURCE-OWNERS-v1', finding: 'P0_SOURCE_OWNER', createdAt: new Date().toISOString(), sourceKeys: definitions.map(d=>d.key), companyIds: [...companyIds], operations, evidence: { sources: evidence },
    invariants: ['oracle','lifecycle','smcp','source-owners'], ownerRules: definitions.map(d=>({sourceKey:d.key,name:d.expected,...(d.key==='browns'?{departmentMap:farfetchDepartments}:{})})) };
}

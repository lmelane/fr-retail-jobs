import { assertPipelineRunning } from '../lib/pipelinePause.js';
import type { PrismaClient } from '@prisma/client';
import { applySectors, previewSectors, sectorHash, type SectorEvidence, type SectorManifest } from './review.js';
import { REVIEWED_SECTOR_RULES, REVIEWED_SECTOR_TAXONOMY } from './reviewed-rules.js';

export type SectorRule = {
  canonicalKey: string; name: string; domain: string;
  codes: string[]; source: string; statement: string; checkedAt: string; validUntil: string;
};
type Employer = { id: string; canonicalKey: string; name: string; domain: string | null; sectorCodes: string[]; sectorEvidence: unknown };
type Concept = { code: string; slug: string; definition: string };
const identity = (s: string) => s.normalize('NFKC').trim().toLowerCase();
export const sectorTaxonomyHash = (concepts: Concept[]) => sectorHash(concepts.map(({code,slug,definition}) => ({code,slug,definition})).sort((a,b) => a.code.localeCompare(b.code)));

/** Reviewed evidence is reusable, model suggestions alone are not. No network,
 * no legacy sector inference and no assignment inherited from a parent group. */
export function qualificationManifest(employers: Employer[], concepts: Concept[], rules: SectorRule[] = REVIEWED_SECTOR_RULES,
  taxonomyHash = REVIEWED_SECTOR_TAXONOMY, now = new Date()) {
  const manifest: SectorManifest = { reviewer: 'reviewed-official-evidence/2026-09-24-v1', companies: [] };
  const abstentions: { id: string; reason: string }[] = [];
  const currentHash = sectorTaxonomyHash(concepts);
  for (const company of employers) {
    const matches = rules.filter(r => r.canonicalKey === company.canonicalKey);
    const rule = matches[0];
    let reason: string | undefined;
    if (matches.length !== 1) reason = matches.length ? 'AMBIGUOUS_RULE' : 'NO_REVIEWED_EVIDENCE';
    else if (currentHash !== taxonomyHash) reason = 'TAXONOMY_CHANGED';
    else if (identity(company.name) !== identity(rule.name) || company.domain !== rule.domain) reason = 'IDENTITY_CHANGED';
    else if (!Number.isFinite(Date.parse(rule.validUntil)) || now >= new Date(rule.validUntil) || new Date(rule.checkedAt) > now) reason = 'EVIDENCE_EXPIRED';
    if (reason) { if (!company.sectorCodes.length || rule) abstentions.push({ id: company.id, reason }); continue; }
    const previous = Array.isArray(company.sectorEvidence) ? company.sectorEvidence as SectorEvidence[] : [];
    const evidenceHash = sectorHash(rule);
    const retained = previous.filter(e => !rule.codes.includes(e.code));
    const evidence: SectorEvidence[] = [...retained, ...rule.codes.map(code => ({
      code, source: rule.source, statement: rule.statement, confidence: 'HIGH' as const, basis: 'OFFICIAL_SOURCE' as const,
      checkedAt: rule.checkedAt, provenance: { method: 'reviewed-official-evidence' as const, version: '2026-09-24-v1',
        taxonomyHash: currentHash, evidenceHash, model: null, promptVersion: null, validUntil: rule.validUntil },
    }))];
    const codes = [...new Set([...company.sectorCodes,...rule.codes])].sort();
    if (sectorHash([codes,evidence]) !== sectorHash([company.sectorCodes,company.sectorEvidence]))
      manifest.companies.push({ id: company.id, canonicalKey: company.canonicalKey, identity: {name:company.name,domain:company.domain!}, codes, evidence });
  }
  return { manifest, abstentions, inspected: employers.length };
}

export async function previewQualification(db: PrismaClient) {
  const [employers,concepts] = await Promise.all([
    db.company.findMany({ where: { mergedIntoId: null }, select: { id:true,canonicalKey:true,name:true,domain:true,sectorCodes:true,sectorEvidence:true }, orderBy:{id:'asc'} }),
    db.sectorConcept.findMany({select:{code:true,slug:true,definition:true}}),
  ]);
  return qualificationManifest(employers,concepts);
}
/** One company per existing review transaction: partial completion is resumable,
 * and a stale identity never approves a different employer. */
export async function maintainReviewedSectors(db: PrismaClient) {
  assertPipelineRunning();
  const plan = await previewQualification(db);
  let changed=0; const failures: {id:string;reason:string}[]=[];
  for (const company of plan.manifest.companies) {
    assertPipelineRunning();
    const manifest = { ...plan.manifest, companies:[company] };
    try { const preview = await previewSectors(db,manifest); changed += (await applySectors(db,manifest,preview.reviewHash)).changed; }
    catch { failures.push({id:company.id,reason:'REVIEW_NOT_APPLIED'}); }
  }
  return { inspected:plan.inspected, changed, abstained:plan.abstentions.length, failures };
}

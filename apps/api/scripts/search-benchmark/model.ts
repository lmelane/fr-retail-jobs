import { createIntentResolver, searchWords, type SearchConcept, type SearchCompany } from '../../lib/search-intent';
import type { OccupationManifest } from '../../../../packages/db/occupation-engine';

export type Company = { id: string; name: string; parentGroup: string | null; parentGroupId: string | null; mergedIntoId: string | null; sectorCodes: string[] };
export type SnapshotMetadata = {
  asOf: string;
  occupationRelease: { id: string; manifest: OccupationManifest };
  companies: Company[];
  aliases: { companyId: string; displayName: string; reviewId: string }[];
  sectorConcepts: { code: string; labels: Record<string, string> }[];
};
export type NativeJob = {
  id: string; title: string; rawTitle?: string; companyId?: string; company?: string;
  description?: string; countryCode: string | null; city?: string; location?: string;
  department?: string; occupationCode?: string; jobFunction?: string;
  sectorCodes?: string[]; postedAt?: string; firstSeenAt?: string; receivedAt?: string;
  employmentTerm?: string; workTime?: string; programType?: string; language?: string;
};
export type SearchDocument = {
  id: string; origin: number; country: string | null; city: string;
  title: string; company: string; body: string;
  roles: string[]; families: string[]; sectors: string[]; companyKeys: string[];
  postedAt: number; firstSeenAt: number;
  occupationCode: string | null; employmentTerm: string | null; workTime: string | null;
  programType: string | null; language: string | null;
};
const normalized = (s: string | null | undefined) => searchWords(s ?? '').join(' ');

export function snapshotModel(metadata: SnapshotMetadata) {
  const concepts: SearchConcept[] = [];
  for (const o of metadata.occupationRelease.manifest.occupations) concepts.push({
    key: o.key, kind: 'role', aliases: [...new Set([...Object.values(o.labels), ...(o.aliases ?? [])])],
  });
  for (const f of metadata.occupationRelease.manifest.families) concepts.push({ key: f.key, kind: 'family', aliases: Object.values(f.labels) });
  for (const s of metadata.sectorConcepts) concepts.push({ key: s.code, kind: 'sector', aliases: Object.values(s.labels) });
  const companies = new Map(metadata.companies.map(c => [c.id, c]));
  const names: SearchCompany[] = metadata.companies.filter(c => !c.mergedIntoId).map(c => ({
    id: c.id, names: [c.name, ...metadata.aliases.filter(a => a.companyId === c.id && a.reviewId).map(a => a.displayName),
      ...metadata.companies.filter(old => old.mergedIntoId === c.id).map(old => old.name)],
  }));
  // A group query reaches its known members; a brand query never expands to
  // every sister brand or to the whole parent catalogue.
  const groups = [...new Set(metadata.companies.flatMap(c => c.parentGroup ? [c.parentGroup] : []))];
  for (const name of groups) {
    if (!names.some(c => c.names.some(n => normalized(n) === normalized(name)))) names.push({ id: `group:${normalized(name)}`, names: [name] });
  }
  const resolver = createIntentResolver(concepts, names);
  return { resolver, concepts, names,
    document(j: NativeJob, direct = false): SearchDocument {
      const c = j.companyId ? companies.get(j.companyId) : undefined;
      const titleConcepts = resolver.titleConcepts(j.rawTitle || j.title);
      // A title's explicit role takes precedence over contradictory historical
      // classification. Missing codes never suppress title/text retrieval.
      const roles = titleConcepts.roles.length ? titleConcepts.roles : j.occupationCode ? [j.occupationCode] : [];
      const parent = c?.parentGroupId || (c?.parentGroup && names.find(n => n.names.some(x => normalized(x) === normalized(c.parentGroup)))?.id);
      return {
        id: direct ? `cw_${j.id}` : j.id, origin: direct ? 0 : 1, country: j.countryCode,
        city: normalized(j.city), title: normalized(j.rawTitle || j.title), company: normalized(c?.name || j.company),
        body: normalized([j.description?.replace(/<[^>]*>/g, ' '), j.department, j.city, j.location, j.employmentTerm].filter(Boolean).join(' ')),
        roles, families: [...new Set([...titleConcepts.families, ...(j.jobFunction ? [j.jobFunction] : [])])],
        sectors: c?.sectorCodes ?? j.sectorCodes ?? [], companyKeys: [c?.id, parent].filter((x): x is string => !!x),
        postedAt: j.postedAt ? Date.parse(j.postedAt) : -1e15,
        firstSeenAt: Date.parse(j.firstSeenAt || j.receivedAt || metadata.asOf),
        occupationCode: j.occupationCode ?? null, employmentTerm: j.employmentTerm ?? null,
        workTime: j.workTime ?? null, programType: j.programType ?? null, language: j.language ?? null,
      };
    },
  };
}

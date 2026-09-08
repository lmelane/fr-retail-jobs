/** Reproducible full-directory join. Name matches are candidates, not identity certification. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseFashionJobsCompanies } from '../../../apps/aggregator/src/connectors/fashionjobs/companyDirectory.js';
import { resolveCompany } from '../../../apps/aggregator/src/normalize/company.js';

const root = 'backups/remediation-20260908';
const out = 'audits/2026-09-08/fashionjobs-coverage';
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const db = read(`${root}/directory-production-current.json`);
const html = readFileSync(`${root}/fashionjobs-directory.html`, 'utf8');
const directory = parseFashionJobsCompanies(html);
const old = read(`${root}/fashionjobs-directory.json`);
const decisions: any[] = existsSync(`${out}/identity-and-portal-decisions.json`) ? read(`${out}/identity-and-portal-decisions.json`) : [];
const extracted: any[] = existsSync(`${out}/discovery-evidence.json`) ? read(`${out}/discovery-evidence.json`) : [];
const norm = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sources = new Map<string, any>(db.sources.map((s: any) => [s.key, s]));
const counts = new Map<string, any>(db.counts.map((c: any) => [c.companyId, c]));
const official = (s: any) => ['EMPLOYER_DIRECT','ATS_OFFICIAL','GROUP_OFFICIAL'].includes(s.tier);
const research = new Map<string, any>();
for (const mode of ['known','profiles']) {
  const path = `${root}/portal-research-${mode}.jsonl`;
  if (existsSync(path)) for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    try { const r = JSON.parse(line); research.set(r.name, r); } catch { /* incomplete final append: next build will include it */ }
  }
}
const rows = directory.map(d => {
  const decision = decisions.find(r => r.directoryNames.includes(d.name));
  const normalized = resolveCompany(d.name).companyId;
  const exact = db.companies.filter((c: any) => [c.name,c.canonicalKey,...c.aliases.flatMap((a: any) => [a.aliasKey,a.displayName])].filter(Boolean).some(n => norm(n) === norm(d.name)));
  const mapped = db.companies.filter((c: any) => c.canonicalKey === normalized || decision?.companyCanonicalKeys?.includes(c.canonicalKey));
  const companies: any[] = [...new Map([...exact,...mapped].map(c => [c.id,c])).values()];
  const ids = new Set(companies.map(c => c.id));
  const nameKeys = new Set([d.name,...companies.flatMap(c => [c.name,c.canonicalKey]),...(decision?.catalogueNames ?? [])].map(norm));
  const byCatalogue = db.sources.filter((s: any) => nameKeys.has(norm(s.maison)) || nameKeys.has(norm(s.key)) || decision?.sourceKeys?.includes(s.key));
  const byJobs = db.links.filter((l: any) => ids.has(l.companyId)).map((l: any) => sources.get(l.sourceKey)).filter(Boolean);
  const linked: any[] = [...new Map([...byCatalogue,...byJobs].map(s => [s.key,s])).values()];
  const direct = linked.filter(s => s.status === 'ACTIVE' && official(s));
  const groupMapped = Boolean(decision?.groupOnly);
  const status = direct.length ? groupMapped ? 'PORTAIL_GROUPE_CATALOGUE_ATTRIBUTION_A_VERIFIER' : 'SOURCE_DIRECTE_CATALOGUEE_A_CERTIFIER'
    : byCatalogue.length ? 'SOURCE_CATALOGUEE_SANS_DIRECT_ACTIF'
    : companies.length ? 'COMPANY_PRESENTE_SANS_DIRECT_IDENTIFIE' : 'AUCUN_RAPPROCHEMENT_ETABLI';
  const sum = (key: string) => companies.reduce((n,c) => n+(counts.get(c.id)?.[key] ?? 0),0);
  const r = research.get(d.name);
  const candidates = extracted.find(r=>r.name===d.name)?.links.filter((l:any)=>!l.indirectBoard) ?? [];
  return {
    nom_fashionjobs: d.name, offres_annuaire: d.offerCount ?? '', fiche_fashionjobs: d.fashionjobsUrl,
    statut_couverture: status, type_acteur: decision?.actorType ?? 'A_QUALIFIER',
    methode_rapprochement: decision?.companyCanonicalKeys?.length ? 'NOM_ALIAS_ET_DECISION_DOCUMENTEE' : exact.length ? 'NOM_OU_ALIAS_EXACT_CANDIDAT' : mapped.length ? 'REGLE_CANONIQUE_CANDIDATE' : 'AUCUNE',
    company_ids: companies.map(c=>c.id).join(' | '), companies: companies.map(c=>c.name).join(' | '), ambiguite_plusieurs_fiches: companies.length > 1 ? 'OUI' : 'NON',
    offres_base_monde: sum('world'), offres_base_france: sum('france'), offres_base_source_directe_france: sum('directFrance'), offres_directes_sans_pays: sum('directCountryMissing'),
    ecart_base_direct_fr_moins_annuaire: d.offerCount === undefined || !companies.length || groupMapped ? '' : sum('directFrance') - d.offerCount,
    comparaison_certifiee: 'NON_PERIMETRES_ET_FRAICHEUR_A_ATTESTER',
    domaines_base: companies.map(c=>c.domain).filter(Boolean).join(' | '), sources_catalogue: byCatalogue.map(s=>`${s.key}:${s.status}`).join(' | '),
    sources_directes_actives: direct.map(s=>s.key).join(' | '), portails_groupe: groupMapped ? decision.sourceKeys.join(' | ') : '',
    ats_directs_catalogues: [...new Set(direct.map(s=>s.kind))].join(' | '),
    portails_directs_catalogues_a_certifier: [...new Set(direct.flatMap(s=>{
      const configured = Object.values(s.config ?? {}).filter((v): v is string=>typeof v==='string' && /^https?:\/\//i.test(v));
      return configured.length ? configured.map(v=>{const u=new URL(v); for(const k of [...u.searchParams.keys()]) if(/token|signature|auth|api.?key|jwt/i.test(k))u.searchParams.delete(k); return u.toString();}) : s.careersDomain ? [s.careersDomain] : [];
    }))].join(' | '),
    statut_recherche: r?.status ?? 'NON_ENCORE_TRAITE',
    liens_carriere_candidats_non_certifies: [...new Set(candidates.map((l:any)=>l.to))].join(' | '),
    sites_candidats_lus: (r?.pages ?? []).filter((p: any)=>p.from === r.candidateOrigin).map((p: any)=>p.url).join(' | '),
    portail_revu: decision?.portalUrl ?? '', preuve_identite_ou_portail: (decision?.evidenceUrls ?? []).join(' | '),
    qualification_documentee: decision?.verdict ?? 'NON_CERTIFIE_PAR_CETTE_RECHERCHE',
    ats_revu: decision?.ats ?? '', prochaine_action: decision?.nextAction ?? (direct.length ? 'Certifier identité, attribution et complétude de la source existante' : 'Retrouver puis prouver le portail officiel; vérifier aussi les groupes et alias'),
  };
}).sort((a,b) => Number(b.offres_annuaire)-Number(a.offres_annuaire) || a.nom_fashionjobs.localeCompare(b.nom_fashionjobs));
const csv = (value: unknown) => '"'+String(value ?? '').replaceAll('"','""')+'"';
writeFileSync(`${out}/annuaire-croise.csv`, '\uFEFF'+[Object.keys(rows[0]).map(csv).join(','),...rows.map(r=>Object.values(r).map(csv).join(','))].join('\n')+'\n');
const summary = { directoryUrl: 'https://fr.fashionjobs.com/societesrecrutent/', directoryObservedAt: '2026-09-08T18:09:15.743Z', productionAt: db.at,
  htmlSha256: createHash('sha256').update(html).digest('hex'), directoryEntries: rows.length,
  announcedDirectoryCountSum: directory.reduce((n,r)=>n+(r.offerCount ?? 0),0), entriesWithoutCounter: directory.filter(r=>r.offerCount === undefined).length,
  distinctCandidateCompanyIds: new Set(rows.flatMap(r=>r.company_ids.split(' | ').filter(Boolean))).size,
  coverageStates: Object.fromEntries([...new Set(rows.map(r=>r.statut_couverture))].map(s=>[s,rows.filter(r=>r.statut_couverture===s).length])),
  researchStates: Object.fromEntries([...new Set(rows.map(r=>r.statut_recherche))].map(s=>[s,rows.filter(r=>r.statut_recherche===s).length])),
  ambiguousCompanyMatches: rows.filter(r=>r.ambiguite_plusieurs_fiches==='OUI').length,
  subjectsWithCareerLinkCandidates: rows.filter(r=>r.liens_carriere_candidats_non_certifies).length,
  counterCorrections: directory.flatMap(d=>{const before=old.find((o:any)=>o.fashionjobsUrl===d.fashionjobsUrl);return before?.offerCount!==d.offerCount?[{name:d.name,before:before?.offerCount,after:d.offerCount}]:[]}),
  production: { companies: db.companies.length, companiesWithActiveJobs: db.counts.length, activeJobs: db.counts.reduce((n:number,c:any)=>n+c.world,0), france: db.counts.reduce((n:number,c:any)=>n+c.france,0), activeSources: db.sources.filter((s:any)=>s.status==='ACTIVE').length, structuredIdentityReviews: db.validatedIdentityReviews },
  note: 'Complete observed directory, not all historical FashionJobs customers. Company and source matches are not identity approvals. Counts are signals, not proven recall or duplicate rates.' };
writeFileSync(`${out}/annuaire-summary.json`,JSON.stringify(summary,null,2)+'\n');
writeFileSync(`${root}/directory-corrected.json`,JSON.stringify(directory),{mode:0o600});
console.log(JSON.stringify(summary,null,2));

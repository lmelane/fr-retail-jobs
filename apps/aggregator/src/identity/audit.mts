/** Read-only, repeatable employer identity inventory. Never proposes an automatic merge. */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveCompany } from '../normalize/company.js';
import { normalizedEmployerName } from '../normalize/employerName.js';
import { employerIdentityHealth } from './health.js';
const directory = process.argv[2];
if (!directory) throw new Error('Usage: identity/audit.mts <output-directory>');
const p = new PrismaClient();
try {
  const snapshot = await p.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const companies = await tx.company.findMany({ orderBy: { id: 'asc' }, select: {
      id: true, name: true, canonicalKey: true, kind: true, sector: true, domain: true, parentGroup: true,
      parentGroupId: true, mergedIntoId: true, aliases: { select: { id: true, sourceKey: true, displayName: true, normalizedName: true, reviewId: true } },
      _count: { select: { jobs: true } },
    } });
    const footprint = await tx.$queryRaw<{ companyId: string; active: number; total: number }[]>`SELECT "companyId",count(*)::int total,count(*) FILTER (WHERE "isActive")::int active FROM "Job" GROUP BY "companyId"`;
    const labels = await tx.$queryRaw<any[]>`WITH candidates AS (
      SELECT js.id, js."sourceKey",j."companyId",v.path,v.role,v.value#>>'{}' label
      FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" CROSS JOIN LATERAL (VALUES
        ('hiringOrganization.name','HIRING_ORGANIZATION',js.raw#>'{hiringOrganization,name}'),
        ('organization.name','ORGANIZATION',js.raw#>'{organization,name}'),
        ('company.name','COMPANY',js.raw#>'{company,name}'),
        ('companyName','COMPANY',js.raw->'companyName'),('company','COMPANY',js.raw->'company'),
        ('employerName','EMPLOYER',js.raw->'employerName'),
        ('detail.hiringOrganization.name','HIRING_ORGANIZATION',js.raw#>'{detail,hiringOrganization,name}'),
        ('detail.jobPostingInfo.logoImage.alt','LOGO_ALT',js.raw#>'{detail,jobPostingInfo,logoImage,alt}'),
        ('entity.name','ENTITY',js.raw#>'{entity,name}')
      )v(path,role,value) WHERE jsonb_typeof(v.value)='string' AND length(v.value#>>'{}')>0
    ) SELECT "sourceKey",path,role,label,count(*)::int representations,array_agg(DISTINCT "companyId") companies FROM candidates GROUP BY 1,2,3,4 ORDER BY 1,2,4`;
    return { asOf: new Date().toISOString(), health: await employerIdentityHealth(tx), counts: {
      companies: companies.length, aliases: await tx.companyAlias.count(), jobs: await tx.job.count(),
      activeJobs: await tx.job.count({ where: { isActive: true } }), representations: await tx.jobSource.count(),
      events: await tx.jobEvent.count(), observations: await tx.sourceObservation.count(),
    }, companies, footprint, labels };
  }, { isolationLevel: 'RepeatableRead', timeout: 120_000 });
  const buckets = new Map<string, typeof snapshot.companies>();
  const add = (reason: string, key: string | null, c: (typeof snapshot.companies)[number]) => {
    if (!key) return; const k = reason + '\0' + key; const list = buckets.get(k) ?? []; list.push(c); buckets.set(k, list);
  };
  for (const c of snapshot.companies.filter(c => !c.mergedIntoId)) {
    const basic = normalizedEmployerName(c.name);
    add('CASE_WHITESPACE', basic, c);
    add('PUNCTUATION_DIACRITICS', basic.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[\p{P}\p{Z}\s]+/gu,' ').trim(), c);
    add('LEGACY_NORMALIZER_COLLISION', resolveCompany(c.name).companyId, c);
    add('SHARED_DOMAIN_NOT_SUFFICIENT', c.domain?.toLowerCase() ?? null, c);
    add('SUFFIX_CANDIDATE', basic.replace(/[\p{P}\p{Z}\s]+/gu,' ').trim().replace(/ (magasins?|retail|france|paris|lp|group|groupe)$/,''), c);
  }
  const pairs = new Map<string, { a: { id: string; name: string }; b: { id: string; name: string }; reasons: string[]; status: string }>();
  for (const [bucket, entries] of buckets) for (let i=0;i<entries.length;i++) for (let j=i+1;j<entries.length;j++) {
    const a=entries[i],b=entries[j],key=[a.id,b.id].sort().join(':');
    const pair=pairs.get(key)??{a:{id:a.id,name:a.name},b:{id:b.id,name:b.name},reasons:[],status:'REVIEW_REQUIRED_NOT_A_MERGE'};
    pair.reasons.push(bucket.split('\0')[0]);pairs.set(key,pair);
  }
  const active = new Map(snapshot.footprint.map(f=>[f.companyId,f.active]));
  const report = { ...snapshot, rawLabelMetrics: { explicitPaths: 9, distinctLabels: new Set(snapshot.labels.map(l=>l.label)).size, sources: new Set(snapshot.labels.map(l=>l.sourceKey)).size, exhaustive: false, reason: 'Only explicit stored paths are measured; legacy Workday detail and unlisted adapter structures are not reconstructed.' }, candidatePairs:[...pairs.values()], candidatePairsWithBothActive:[...pairs.values()].filter(p=>(active.get(p.a.id)??0)>0&&(active.get(p.b.id)??0)>0).length };
  mkdirSync(directory,{recursive:true});writeFileSync(`${directory}/inventory.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({counts:report.counts,health:report.health,rawLabelMetrics:report.rawLabelMetrics,candidatePairs:pairs.size,candidatePairsWithBothActive:report.candidatePairsWithBothActive}));
} finally { await p.$disconnect(); }

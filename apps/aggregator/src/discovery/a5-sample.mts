import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

/**
 * Audit a5 — échantillonnage (lecture seule) des offres actives à sonder.
 *   principal : 40 sources les plus volumineuses × 5 offres au hasard = 200
 *   stale     : offres actives non re-vues depuis > 48 h (max 40)
 *   old       : offres actives postedAt > 2 ans (20)
 * Usage : npx tsx src/discovery/a5-sample.mts <outDir>
 */
const outDir = process.argv[2];
if (!outDir) throw new Error('usage: a5-sample.mts <outDir>');
const p = new PrismaClient();

type Row = { sourceKey: string; id: string; job_url: string; js_url: string; title: string; lastSeenAt: Date };

const main = await p.$queryRawUnsafe<Row[]>(`
  with top as (
    select s."sourceKey", count(distinct s."jobId") as n
    from "JobSource" s join "Job" j on j.id = s."jobId"
    where j."isActive" and s."isActive"
    group by s."sourceKey" order by n desc limit 40
  )
  select t."sourceKey", x.id, x.job_url, x.js_url, x.title, x."lastSeenAt"
  from top t cross join lateral (
    select j.id, j.url as job_url, s.url as js_url, j.title, j."lastSeenAt"
    from "JobSource" s join "Job" j on j.id = s."jobId"
    where s."sourceKey" = t."sourceKey" and j."isActive" and s."isActive"
    order by random() limit 5
  ) x
`);
const stale = await p.$queryRawUnsafe<Row[]>(`
  select s."sourceKey", j.id, j.url as job_url, s.url as js_url, j.title, j."lastSeenAt"
  from "Job" j join lateral (
    select "sourceKey", url from "JobSource" s where s."jobId" = j.id order by s."lastSeenAt" desc limit 1
  ) s on true
  where j."isActive" and j."lastSeenAt" <= now() - interval '48 hours'
  order by random() limit 40
`);
const old = await p.$queryRawUnsafe<Row[]>(`
  select s."sourceKey", j.id, j.url as job_url, s.url as js_url, j.title, j."lastSeenAt"
  from "Job" j join lateral (
    select "sourceKey", url from "JobSource" s where s."jobId" = j.id order by s."lastSeenAt" desc limit 1
  ) s on true
  where j."isActive" and j."postedAt" < now() - interval '730 days'
  order by random() limit 20
`);
const ids = await p.$queryRawUnsafe<{ id: string; isActive: boolean }[]>(`
  (select id, "isActive" from "Job" where not "isActive" order by random() limit 10)
  union all
  (select id, "isActive" from "Job" where "isActive" order by random() limit 10)
`);
writeFileSync(`${outDir}/a5-sample-main.json`, JSON.stringify(main, null, 1));
writeFileSync(`${outDir}/a5-sample-stale.json`, JSON.stringify(stale, null, 1));
writeFileSync(`${outDir}/a5-sample-old.json`, JSON.stringify(old, null, 1));
writeFileSync(`${outDir}/a5-site-ids.json`, JSON.stringify(ids, null, 1));
console.log(`main=${main.length} stale=${stale.length} old=${old.length} ids=${ids.length}`);
console.log('sources:', [...new Set(main.map((r) => r.sourceKey))].join(' '));
console.log('job_url != js_url:', main.filter((r) => r.job_url !== r.js_url).length, '/', main.length);
await p.$disconnect();

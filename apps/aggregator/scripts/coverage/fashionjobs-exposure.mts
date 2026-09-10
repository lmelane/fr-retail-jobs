/**
 * FashionJobs is a DISCOVERY source for actors — never a source of postings (owner rule, unchanged).
 * This prepares the treatment WITHOUT applying it: it splits the postings attached to `fashionjobs` into the ones
 * an official source also attests, and the ones that depend on FashionJobs alone.
 *
 * The distinction decides the treatment, and the two must never be confused:
 *   • ALSO_OFFICIAL  — detaching the FashionJobs representation changes nothing the candidate sees; the posting
 *                      keeps a live official attestation. Safe to detach.
 *   • ONLY_FASHIONJOBS — the posting exists publicly ONLY because of a source that must not supply postings.
 *                      Withdrawing it removes it from the site. That is an ADMINISTRATIVE withdrawal, not an
 *                      employer closing a vacancy: it must never be recorded as a CLOSED job event, and RAW,
 *                      identifiers and history are preserved (D27 `retire-source` semantics).
 *
 * Read-only. One REPEATABLE READ snapshot. Writes a per-posting CSV so the treatment is auditable by identifier.
 *
 * Usage: npx tsx apps/aggregator/scripts/coverage/fashionjobs-exposure.mts <output-dir>
 */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) { console.error('usage: fashionjobs-exposure.mts <output-dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });

const p = new PrismaClient({ log: [] });
try {
  const db: any = await p.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const iso: any[] = await tx.$queryRaw`SELECT current_setting('transaction_isolation') AS level`;
    const clock: any[] = await tx.$queryRaw`SELECT now() AS at`;
    /**
     * "Official attestation" = an active representation under a source that is ACTIVE (a PAUSED source is not
     * collecting any more, so it cannot vouch for a posting still being open) and that is NOT fashionjobs itself.
     */
    const rows: any[] = await tx.$queryRaw`
      SELECT j.id, c.name AS company, LEFT(j.title, 90) AS title, j.city, j."countryCode", j."isFrance",
             j."firstSeenAt", j."lastSeenAt", j."postedAt", js."externalId",
             (SELECT string_agg(DISTINCT js2."sourceKey" || ':' || s2.status, ', ')
              FROM "JobSource" js2 JOIN "Source" s2 ON s2.key = js2."sourceKey"
              WHERE js2."jobId" = j.id AND js2."isActive" AND js2."sourceKey" <> 'fashionjobs') AS other_live,
             EXISTS (SELECT 1 FROM "JobSource" js3 JOIN "Source" s3 ON s3.key = js3."sourceKey"
                     WHERE js3."jobId" = j.id AND js3."isActive" AND s3.status = 'ACTIVE' AND js3."sourceKey" <> 'fashionjobs') AS also_official
      FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId" JOIN "Company" c ON c.id = j."companyId"
      WHERE js."sourceKey" = 'fashionjobs' AND js."isActive" AND j."isActive"
      ORDER BY also_official, c.name, j."firstSeenAt"`;
    const byCompany: any[] = await tx.$queryRaw`
      SELECT c.name, COUNT(*)::int total,
             COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "JobSource" js3 JOIN "Source" s3 ON s3.key=js3."sourceKey"
               WHERE js3."jobId"=j.id AND js3."isActive" AND s3.status='ACTIVE' AND js3."sourceKey" <> 'fashionjobs'))::int only_fj
      FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" JOIN "Company" c ON c.id=j."companyId"
      WHERE js."sourceKey"='fashionjobs' AND js."isActive" AND j."isActive"
      GROUP BY 1 ORDER BY 3 DESC, 2 DESC`;
    return { at: clock[0].at as Date, isolation: iso[0].level as string, rows, byCompany };
  }, { isolationLevel: 'RepeatableRead' });
  if (db.isolation !== 'repeatable read') throw new Error(`fashionjobs-exposure requires REPEATABLE READ; got "${db.isolation}"`);

  const onlyFj = db.rows.filter((r: any) => !r.also_official);
  const alsoOfficial = db.rows.filter((r: any) => r.also_official);
  const summary = {
    at: db.at.toISOString(), isolation: db.isolation,
    rule: 'FashionJobs discovers actors; it never supplies postings.',
    postingsAttachedToFashionJobs: db.rows.length,
    alsoAttestedByAnActiveOfficialSource: { postings: alsoOfficial.length, treatment: 'detach the FashionJobs representation — the posting keeps its official attestation and stays published' },
    dependingOnFashionJobsAlone: { postings: onlyFj.length, companies: new Set(onlyFj.map((r: any) => r.company)).size,
      treatment: 'ADMINISTRATIVE withdrawal (D27 retire-source semantics): RAW, identifiers and history preserved; MUST NOT be recorded as an employer closing the vacancy' },
    withFrenchScope: onlyFj.filter((r: any) => r.isFrance).length,
    topCompanies: db.byCompany.slice(0, 12).map((c: any) => ({ company: c.name, attached: c.total, onlyFashionJobs: c.only_fj })),
  };
  const csvEsc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const cols = ['id', 'externalId', 'company', 'title', 'city', 'countryCode', 'isFrance', 'firstSeenAt', 'lastSeenAt', 'postedAt', 'also_official', 'other_live'];
  writeFileSync(`${out}/fashionjobs-postings.csv`, [cols.join(','), ...db.rows.map((r: any) => cols.map((c) => csvEsc(r[c])).join(','))].join('\n') + '\n');
  writeFileSync(`${out}/fashionjobs-exposure.json`, JSON.stringify({ summary, byCompany: db.byCompany }, null, 1) + '\n');
  console.log(JSON.stringify(summary, null, 1));
} finally { await p.$disconnect(); }

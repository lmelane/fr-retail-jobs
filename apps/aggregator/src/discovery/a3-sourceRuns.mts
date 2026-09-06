/**
 * a3 — cadence : historique SourceRun, tailles de sources, churn des offres,
 * curseurs rotatifs, fraîcheur des attestations. LECTURE SEULE (SELECT only).
 *
 * Usage : DATABASE_URL=… npx tsx src/discovery/a3-sourceRuns.mts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const q = <T = Record<string, unknown>>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
const table = (title: string, rows: unknown[]) => {
  console.log(`\n## ${title}`);
  console.table(rows.map((r) => Object.fromEntries(Object.entries(r as object).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v instanceof Date ? v.toISOString().slice(0, 16) : v]))));
};

try {
  table('A. Runs du jour — lignes SourceRun par tranche de 5 min et statut', await q(`
    SELECT to_char(date_trunc('hour', "ranAt") + floor(extract(minute from "ranAt")/5)*interval '5 min', 'HH24:MI') AS slot,
           count(*)::int AS rows, sum(jobs)::int AS jobs,
           count(*) FILTER (WHERE status='OK')::int AS ok,
           count(*) FILTER (WHERE status='DEGRADED')::int AS degraded,
           count(*) FILTER (WHERE status='BROKEN')::int AS broken,
           count(*) FILTER (WHERE status IN ('TIMEOUT','ERROR'))::int AS unfinished,
           count(*) FILTER (WHERE status='NEW')::int AS new
    FROM "SourceRun" WHERE "ranAt" >= '2026-09-06T07:00:00Z'
    GROUP BY 1 ORDER BY 1`));

  table('A2. Runs des 10 derniers jours — une ligne par run (≥ 50 sources dans la même heure)', await q(`
    SELECT to_char(date_trunc('hour', "ranAt"), 'MM-DD HH24:00') AS run_hour, count(*)::int AS sources, sum(jobs)::int AS jobs,
           count(*) FILTER (WHERE status IN ('BROKEN','TIMEOUT','ERROR'))::int AS bad,
           count(*) FILTER (WHERE status='DEGRADED')::int AS degraded,
           to_char(min("ranAt"),'HH24:MI') AS first_row, to_char(max("ranAt"),'HH24:MI') AS last_row
    FROM "SourceRun" GROUP BY 1 HAVING count(*) >= 50 ORDER BY 1`));

  table('B. Run 2 (09:11→09:54, coupé) — les 6 sources sans ligne SourceRun', await q(`
    SELECT k AS source_key,
      (SELECT count(*) FROM "SourceRun" r WHERE r."sourceKey"=k AND r."ranAt" BETWEEN '2026-09-06T09:11:00Z' AND '2026-09-06T10:00:00Z')::int AS rows_run2,
      (SELECT status FROM "SourceRun" r WHERE r."sourceKey"=k ORDER BY "ranAt" DESC LIMIT 1) AS last_status,
      (SELECT to_char("ranAt",'MM-DD HH24:MI') FROM "SourceRun" r WHERE r."sourceKey"=k ORDER BY "ranAt" DESC LIMIT 1) AS last_run
    FROM unnest(ARRAY['michael-page-france','fashionjobs','ulta-jibe','decathlon','loreal','wttj']) AS k`));

  table('C. Sources DEGRADED sur leurs 5 derniers runs ou plus (consécutifs, du plus récent)', await q(`
    WITH ranked AS (
      SELECT "sourceKey", status, jobs, "ranAt", row_number() OVER (PARTITION BY "sourceKey" ORDER BY "ranAt" DESC) AS rn
      FROM "SourceRun"),
    streak AS (
      SELECT "sourceKey",
             count(*) FILTER (WHERE status='DEGRADED')::int AS degraded_in_last10,
             count(*)::int AS runs_kept,
             bool_and(status='DEGRADED') FILTER (WHERE rn <= 5) AS last5_all_degraded,
             max(jobs) FILTER (WHERE rn = 1) AS last_jobs
      FROM ranked WHERE rn <= 10 GROUP BY 1)
    SELECT s."sourceKey", s.last_jobs, s.degraded_in_last10, s.runs_kept,
           (SELECT left(note, 70) FROM "SourceRun" r WHERE r."sourceKey"=s."sourceKey" ORDER BY "ranAt" DESC LIMIT 1) AS last_note
    FROM streak s WHERE s.last5_all_degraded AND s.runs_kept >= 5 ORDER BY s.last_jobs DESC`));

  table('C2. Statut au dernier run, par statut (dernière ligne par source)', await q(`
    WITH last AS (SELECT DISTINCT ON ("sourceKey") "sourceKey", status, jobs FROM "SourceRun" ORDER BY "sourceKey", "ranAt" DESC)
    SELECT status, count(*)::int AS sources, sum(jobs)::int AS jobs FROM last GROUP BY 1 ORDER BY 2 DESC`));

  table('D. Taille des sources (JobSource actives par clé) — tranches', await q(`
    WITH sz AS (SELECT "sourceKey", count(*)::int AS n FROM "JobSource" WHERE "isActive" GROUP BY 1)
    SELECT CASE WHEN n < 20 THEN '1. < 20' WHEN n < 100 THEN '2. 20–99' WHEN n < 500 THEN '3. 100–499' WHEN n < 1500 THEN '4. 500–1499' ELSE '5. ≥ 1500' END AS bucket,
           count(*)::int AS sources, sum(n)::int AS offers, round(100.0*sum(n)/(SELECT sum(n) FROM sz),1) AS pct_offers
    FROM sz GROUP BY 1 ORDER BY 1`));

  table('D2. Les 25 plus grosses sources (JobSource actives)', await q(`
    SELECT js."sourceKey", count(*)::int AS offers, s.kind, s."lastRunStatus", s."lastRunJobs"
    FROM "JobSource" js LEFT JOIN "Source" s ON s.key = js."sourceKey"
    WHERE js."isActive" GROUP BY 1,3,4,5 ORDER BY 2 DESC LIMIT 25`));

  table('E. Churn — offres nouvelles par jour (firstSeenAt) et fermées par jour (isActive=false, lastSeenAt)', await q(`
    SELECT d::date AS day,
      (SELECT count(*) FROM "Job" j WHERE j."firstSeenAt"::date = d::date)::int AS created,
      (SELECT count(*) FROM "Job" j WHERE NOT j."isActive" AND j."lastSeenAt"::date = d::date)::int AS closed_lastseen
    FROM generate_series(now()::date - 9, now()::date, interval '1 day') d ORDER BY 1`));

  table('E2. Offres : actives / inactives, âge médian des actives, part < 48 h', await q(`
    SELECT count(*) FILTER (WHERE "isActive")::int AS active, count(*) FILTER (WHERE NOT "isActive")::int AS inactive,
           round(extract(epoch FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY now()-"firstSeenAt") FILTER (WHERE "isActive"))/86400, 1) AS median_age_days,
           count(*) FILTER (WHERE "isActive" AND "firstSeenAt" > now() - interval '48 hours')::int AS active_new_48h,
           count(*) FILTER (WHERE "isActive" AND "postedAt" IS NOT NULL)::int AS active_with_postedat,
           round(extract(epoch FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY now()-"postedAt") FILTER (WHERE "isActive" AND "postedAt" IS NOT NULL))/86400, 1) AS median_posted_age_days
    FROM "Job"`));

  table('F. Curseurs rotatifs', await q(`SELECT * FROM "SourceCursor"`));

  table('G. Catalogue Source — par statut et famille', await q(`
    SELECT status, count(*)::int AS sources, sum("lastRunJobs")::int AS last_run_jobs FROM "Source" GROUP BY 1 ORDER BY 2 DESC`));

  table('H. Fraîcheur des attestations — JobSource actives par heure de lastSeenAt (aujourd\'hui) et > 48 h', await q(`
    SELECT to_char(date_trunc('hour', "lastSeenAt"), 'MM-DD HH24:00') AS seen_hour, count(*)::int AS job_sources
    FROM "JobSource" WHERE "isActive" GROUP BY 1 ORDER BY 1 DESC LIMIT 12`));
  table('H2. JobSource actives dont lastSeenAt > 48 h (ce que le refresh fermerait s\'il tournait maintenant)', await q(`
    SELECT count(*)::int AS stale_48h, count(DISTINCT "jobId")::int AS jobs,
           (SELECT count(*) FROM "JobSource" WHERE "isActive")::int AS total_active
    FROM "JobSource" WHERE "isActive" AND "lastSeenAt" < now() - interval '48 hours'`));

  table('I. Sources dont lastRunJobs = 0 ou NULL (ACTIVE)', await q(`
    SELECT count(*)::int AS n FROM "Source" WHERE status='ACTIVE' AND coalesce("lastRunJobs",0)=0`));

  table('J. Postgres — version, connexions actives', await q(`
    SELECT version() AS version, (SELECT count(*) FROM pg_stat_activity WHERE datname='railway')::int AS connections`));
} finally {
  await prisma.$disconnect();
}

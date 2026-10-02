-- D-516 §1 : toutes les collectes JOBS de Ralph Lauren depuis le 01/09, leur volume, leur durée, leurs refus et le
-- délai depuis la fin de la collecte précédente de la même source. LECTURE SEULE. Même invocation que collectes.sql.
\pset footer off
with b as (
  select b.id, b."startedAt", b."runId", o.status, o.failure, o."extractedCount", o."transportCoverage",
         (select count(*) from "RawCapture" r where r."batchId" = b.id) n,
         (select min(r."capturedAt") from "RawCapture" r where r."batchId" = b.id) debut,
         (select max(r."capturedAt") from "RawCapture" r where r."batchId" = b.id) fin,
         (select string_agg(r.status::text || '@' || r.sequence, ',' order by r.sequence) from "RawCapture" r
           where r."batchId" = b.id and coalesce(r.status, 0) not in (200)) refus
    from "CaptureBatch" b left join "CaptureOutcome" o on o."batchId" = b.id
   where b."sourceKey" = 'ralph-lauren-avature' and b.purpose = 'JOBS' and b."startedAt" >= '2026-09-01')
select left(id, 8) lot, "startedAt", left(coalesce("runId", ''), 8) run, status, failure, "extractedCount", "transportCoverage", n,
       round(extract(epoch from (fin - debut))::numeric) duree_s,
       round(extract(epoch from (debut - lag(fin) over (order by "startedAt")))::numeric) s_apres_precedente,
       left(refus, 120) refus
  from b order by "startedAt";

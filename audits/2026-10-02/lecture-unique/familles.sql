-- Les familles (lecteurs) des sources du RUN du 01/10, pour choisir 20 sources de familles différentes. LECTURE SEULE.
-- Invocation : comme requetes.sql.
\pset footer off
select s.kind, count(distinct b."sourceKey") sources,
       string_agg(distinct b."sourceKey", ',' order by b."sourceKey") filter (where o."extractedCount" between 5 and 400) exemples
  from "CaptureBatch" b join "PipelineRun" p on p.id = b."runId" join "Source" s on s.key = b."sourceKey"
  left join "CaptureOutcome" o on o."batchId" = b.id
 where b.purpose = 'JOBS' and p.command = 'ingest-all' and p."startedAt" >= '2026-10-01' and p."startedAt" < '2026-10-02'
 group by 1 order by 2 desc;

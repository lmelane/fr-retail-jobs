-- D-516 §1 : dans les RUN quotidiens (ingest-all) du 28/09 au 01/10, combien de sources sont lues deux fois (une
-- collecte de qualification sans décision, puis la collecte d'ingestion sous décision), et à quel coût en requêtes.
-- LECTURE SEULE. Même invocation que collectes.sql.
\pset footer off
with b as (
  select b.id, b."sourceKey", b."accessDecisionId" is not null sous_decision, date_trunc('day', b."startedAt") jour,
         (select count(*) from "RawCapture" r where r."batchId" = b.id) requetes, o.status
    from "CaptureBatch" b join "PipelineRun" p on p.id = b."runId" left join "CaptureOutcome" o on o."batchId" = b.id
   where b.purpose = 'JOBS' and p.command = 'ingest-all' and b."startedAt" >= '2026-09-28' and b."startedAt" < '2026-10-02')
select to_char(jour, 'MM-DD') jour, count(distinct "sourceKey") sources,
       count(distinct "sourceKey") filter (where not sous_decision) sources_requalifiees,
       sum(requetes) filter (where not sous_decision) requetes_qualification,
       sum(requetes) filter (where sous_decision) requetes_ingestion,
       count(*) filter (where sous_decision and status = 'FAILED') ingestions_echouees,
       count(distinct "sourceKey") filter (where sous_decision and status = 'FAILED' and "sourceKey" in
         (select x."sourceKey" from b x where x.jour = b.jour and not x.sous_decision and x.status = 'EXTRACTED')) echec_apres_qualification_reussie
  from b group by jour order by jour;
-- Les raisons de requalification journalisées le 01/10 (source.native_qualification_started).
select e.payload->>'reason' raison, count(*) from "PipelineEvent" e join "PipelineRun" p on p.id = e."runId"
 where p.command = 'ingest-all' and e.event = 'source.native_qualification_started' and p."startedAt" >= '2026-10-01' and p."startedAt" < '2026-10-02'
 group by 1 order by 2 desc;

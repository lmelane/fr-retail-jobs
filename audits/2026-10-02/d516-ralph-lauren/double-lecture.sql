-- D-516 §1 : les deux collectes JOBS quotidiennes de L'Oréal Professionnel (et celles de Ralph Lauren) : quelle
-- commande les lance, avec quelle décision d'accès, combien de requêtes. LECTURE SEULE.
\pset footer off
select b."sourceKey", left(b.id, 8) lot, to_char(b."startedAt", 'MM-DD HH24:MI:SS') debut, p.command, b."accessDecisionId" is not null sous_decision,
       o.status, o."extractedCount", (select count(*) from "RawCapture" r where r."batchId" = b.id) requetes
  from "CaptureBatch" b left join "PipelineRun" p on p.id = b."runId" left join "CaptureOutcome" o on o."batchId" = b.id
 where b.purpose = 'JOBS' and b."startedAt" >= '2026-09-28' and b."sourceKey" in ('l-oreal-professionnel', 'ralph-lauren-avature')
 order by b."startedAt";

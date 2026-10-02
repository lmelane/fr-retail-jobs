-- D-520 : l'historique SourceRun (22/09 → 02/10) des sources touchées par les trois classes, pour séparer baisse
-- confirmée par l'éditeur et perte de lecture. LECTURE SEULE, hors fenêtre du RUN. Même commande que detail.sql.
\pset footer off
\pset format csv
SET statement_timeout = '120s';
SET default_transaction_read_only = on;
SELECT sr."runId", sr."ranAt", sr."sourceKey", s.kind, sr.status, sr.jobs, sr."previousJobs", sr.fetched, sr.accepted,
       sr."declaredTotal", sr.truncated, sr.complete, sr."canAttestAbsence", sr.errors, left(sr.note, 300) note,
       sr."descriptionRate", sr."countryRate"
FROM "SourceRun" sr JOIN "Source" s ON s.key = sr."sourceKey"
WHERE sr."ranAt" >= '2026-09-22'
  AND sr."sourceKey" IN (
    SELECT DISTINCT e."sourceKey" FROM "PipelineEvent" e JOIN "PipelineRun" r ON r.id = e."runId"
    CROSS JOIN LATERAL jsonb_array_elements(e.payload->'issues') i
    WHERE r.command = 'ingest-all' AND r."startedAt" >= '2026-09-24' AND e.event = 'source.issue_classified'
      AND (i->>'code' IN ('ENUMERATION_NOT_PROVEN','ENUMERATION_REFUTED','SOURCE_HEALTH_REGRESSION','NATIVE_RETENTION_JUMP')
           OR i->>'code' LIKE '%COVERAGE%' OR i->>'code' LIKE '%ADMISSION%' OR i->>'code' LIKE '%VALIDATION%'))
ORDER BY sr."sourceKey", sr."ranAt";

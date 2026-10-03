-- D-522 §6 — stock d'exceptions : sources non OK du RUN 9022fc4b (02/10/2026), lecture seule.
-- Rejeu : q.sh "$(cat mesure-run-9022fc4b.sql)" (db.py readonly, psql).
SELECT sr."sourceKey", sr.status, sr.jobs, sr."previousJobs", sr.complete, sr.truncated, sr."canAttestAbsence",
       round(sr."descriptionRate"::numeric, 2) AS desc_rate, round(sr."countryRate"::numeric, 2) AS country_rate,
       (SELECT string_agg(DISTINCT (i->>'code') || coalesce(':' || (i->>'detail'), ''), ', ')
          FROM "PipelineEvent" e, jsonb_array_elements(e.payload->'issues') i
         WHERE e."runId" = sr."runId" AND e."sourceKey" = sr."sourceKey" AND e.event = 'source.issue_classified'
           AND i->>'code' <> 'NATIVE_RETENTION') AS issues_hors_retenue,
       left(sr.note, 200) AS note
  FROM "SourceRun" sr
 WHERE sr."runId" = '9022fc4b-1b96-431d-bee9-86ed244ef4f1' AND sr.status <> 'OK'
 ORDER BY sr.status, sr."sourceKey";

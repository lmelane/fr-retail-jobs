-- D-514 §4 : les captures JOBS de ganni-talentrecruiter sur 7 jours (identifiants à rejouer), lecture seule.
\pset pager off
SELECT b.id, to_char(b."startedAt",'MM-DD HH24:MI:SS') debut, o.status, o."extractedCount" extraites, v.verdict, v.report->'reasons' motifs
FROM "CaptureBatch" b LEFT JOIN "CaptureOutcome" o ON o."batchId"=b.id LEFT JOIN "SourceValidation" v ON v."captureBatchId"=b.id
WHERE b."sourceKey"='ganni-talentrecruiter' AND b.purpose='JOBS' AND b."startedAt" >= now() - interval '7 days'
ORDER BY b."startedAt";

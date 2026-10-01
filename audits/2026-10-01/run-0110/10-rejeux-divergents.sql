-- Validations natives REJECTED par motif, 10 derniers jours (lecture seule).
\pset pager off
SELECT b."sourceKey", to_char(v."validatedAt",'MM-DD HH24:MI') quand, k AS motif, (v.report->'reasons'->>k)::int n
FROM "SourceValidation" v JOIN "CaptureBatch" b ON b.id=v."captureBatchId", jsonb_object_keys(v.report->'reasons') k
WHERE v.verdict='REJECTED' AND v."validatedAt" >= now() - interval '10 days'
ORDER BY k, b."sourceKey", v."validatedAt";

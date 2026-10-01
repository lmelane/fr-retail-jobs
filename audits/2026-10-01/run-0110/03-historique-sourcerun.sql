-- Historique SourceRun sur 6 jours des 11 sources bloquantes du RUN du 01/10/2026 (lecture seule).
\pset pager off
SELECT "sourceKey", to_char("ranAt",'MM-DD HH24:MI') ran, status, jobs, "previousJobs" prev, fetched, accepted, "declaredTotal" decl, truncated tr, complete cpl, errors err, left(coalesce(note,''),220) note
FROM "SourceRun"
WHERE "sourceKey" IN ('browns-shoes','crocs','diptyque-workday','ganni-talentrecruiter','gemmyo','puma','richemont','sephora-france','ulta-jibe','urbn-hub','versace')
  AND "ranAt" >= now() - interval '6 days 3 hours'
ORDER BY 1, "ranAt";

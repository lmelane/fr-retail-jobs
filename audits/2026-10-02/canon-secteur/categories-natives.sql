-- Canonisation du secteur — catégories natives que les sources publient sur l'EMPLOYEUR, en LECTURE SEULE, 02/10/2026.
-- Recensement des clés de `JobSource.raw` qui nomment une industrie ou un secteur, sur les publications actives des
-- offres servies dont la société n'a pas de secteur. Rejouer (jamais entre 15:30 et 18:30 UTC) :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F"	" -f -' < categories-natives.sql
SET statement_timeout = '240s';
\echo '== clés de premier niveau de raw, par type de source (publications actives, sociétés sans secteur)'
WITH p AS (SELECT js."sourceKey", so.kind, js.raw FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
  JOIN "JobSource" js ON js."jobId" = j.id AND js."isActive" JOIN "Source" so ON so.key = js."sourceKey"
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND cardinality(c."sectorCodes") = 0 AND jsonb_typeof(js.raw) = 'object')
SELECT kind, k, count(*) FROM p, jsonb_object_keys(p.raw) k
WHERE k ~* '(industr|sector|secteur|categor|branche|domain|business|division|segment|brand|organi[sz]ation|company)'
GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 80;

-- D-511 — champs natifs d'éditeur qui déclarent une candidature spontanée, dans le RAW des publications publiques.
-- Lecture seule. Cherche des CLÉS (pas des valeurs de titre) : isSpontaneous, openApplication, ProjectType…
\pset pager off
SET statement_timeout = '120s';
WITH pub AS (
  SELECT s."sourceKey", src.kind, s.raw::text AS r
  FROM "Job" j JOIN "JobSource" s ON s."jobId" = j.id JOIN "Source" src ON src.key = s."sourceKey"
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND s."isActive" AND (s."expiresAt" IS NULL OR s."expiresAt" > now())
)
SELECT kind, "sourceKey", m[1] AS cle_valeur, count(*) n
FROM pub, LATERAL regexp_matches(r, '("[A-Za-z_]*(?:[Ss]pontan|[Uu]nsolicited|[Oo]pen_?[Aa]pplication|[Gg]eneral_?[Aa]pplication|[Ii]nitiativ|ProjectType|jobType|postingType|requisitionType|isEvergreen|evergreen)[A-Za-z_]*"\s*:\s*(?:"[^"]{0,40}"|true|false|null|\d+))', 'g') AS m
GROUP BY 1,2,3 ORDER BY 1,2,4 DESC;

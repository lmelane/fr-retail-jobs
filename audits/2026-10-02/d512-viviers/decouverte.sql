-- D-512 — découverte en lecture seule : offres publiques dont l'intitulé contient une forme voisine d'un vivier, dans
-- toutes les langues qu'on sait nommer, comptées par forme (pour mesurer la prémisse : quels libellés existent vraiment).
-- Rejouable :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F "|" -v ON_ERROR_STOP=1 -f <ce fichier>'
SET statement_timeout = '60s';
WITH pub AS (
  SELECT DISTINCT j.id, s.title AS t
  FROM "Job" j JOIN "JobSource" s ON s."jobId" = j.id
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND s."isActive" AND (s."expiresAt" IS NULL OR s."expiresAt" > now())
), m AS (
  SELECT id, t, lower(substring(t from '(?i)(talent[- ]?(?:pool|community|network|bank|hub|pipeline|base|pools)|future\s+(?:opportunit\w*|roles?|positions?|vacanc\w*|openings?|careers?)|opportunit\w+\s+futur\w*|expressions?\s+of\s+interest|express(?:ing)?\s+(?:your\s+)?interest|register\s+(?:your\s+)?interest|vivier|pool\s+de\s+talents?|bolsa\s+de\s+(?:talento|trabajo|empleo)|banca\s+dati|kandidatenpool|bewerberpool|talentepool|stay\s+in\s+touch|keep\s+in\s+touch|general\s+interest|evergreen|always\s+(?:hiring|recruiting)|pipeline\s+(?:role|position|requisition)|join\s+our\s+(?:team|community|network))')) AS forme
  FROM pub
)
SELECT regexp_replace(forme, '\s+', ' ', 'g') AS forme, count(*) AS offres, (array_agg(t ORDER BY t))[1:4] AS exemples
FROM m WHERE forme IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;

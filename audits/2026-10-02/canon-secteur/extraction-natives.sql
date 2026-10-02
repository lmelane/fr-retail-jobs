-- Canonisation du secteur — les catégories natives d'employeur, EXACTEMENT `NATIVE_CATEGORY_SQL` (apps/aggregator/src/sectors/recognize.ts),
-- en LECTURE SEULE, 02/10/2026. Rejouer (jamais entre 15:30 et 18:30 UTC) :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -t -q -f -' < extraction-natives.sql > natives.jsonl
SET statement_timeout = '240s';
SELECT row_to_json(x) FROM (

  WITH p AS (SELECT j."companyId", js."sourceKey", js.url, js.raw FROM "Job" j JOIN "JobSource" js ON js."jobId" = j.id AND js."isActive"
    WHERE j."isActive" AND j."mergedIntoId" IS NULL AND jsonb_typeof(js.raw) = 'object' AND (js.raw ? 'industry' OR js.raw ? 'sectors' OR js.raw ? 'businessGroup')),
  v AS (
    SELECT "companyId", "sourceKey", url, 'industry' champ, CASE jsonb_typeof(raw->'industry') WHEN 'object' THEN raw->'industry'->>'label' WHEN 'string' THEN raw->>'industry' END valeur FROM p WHERE raw ? 'industry'
    UNION ALL SELECT "companyId", "sourceKey", url, 'sectors', s->>'reference' FROM p, jsonb_array_elements(CASE WHEN jsonb_typeof(raw->'sectors') = 'array' THEN raw->'sectors' ELSE '[]'::jsonb END) s
    UNION ALL SELECT "companyId", "sourceKey", url, 'businessGroup', raw->>'businessGroup' FROM p WHERE raw ? 'businessGroup')
  SELECT "companyId", "sourceKey", champ, valeur, count(*)::int n, min(url) url FROM v WHERE coalesce(trim(valeur), '') <> '' GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4) x;

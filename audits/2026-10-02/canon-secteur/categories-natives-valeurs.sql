-- Canonisation du secteur — VALEURS des catégories natives d'employeur, par société sans secteur, en LECTURE SEULE, 02/10/2026.
-- industry (SmartRecruiters, Workable, JSON-LD JobPosting.industry, Radancy), sectors (WTTJ, secteurs de l'organisation),
-- businessGroup (portail LVMH, groupe d'activité de la Maison). Rejouer (jamais entre 15:30 et 18:30 UTC) :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -t -q -f -' < categories-natives-valeurs.sql > categories-natives.jsonl
SET statement_timeout = '240s';
WITH p AS (SELECT c.id "companyId", c.name, js."sourceKey", so.kind, js.raw FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
  JOIN "JobSource" js ON js."jobId" = j.id AND js."isActive" JOIN "Source" so ON so.key = js."sourceKey"
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND jsonb_typeof(js.raw) = 'object'
    AND (js.raw ? 'industry' OR js.raw ? 'sectors' OR js.raw ? 'businessGroup')),
v AS (
  SELECT "companyId", name, "sourceKey", kind, 'industry' champ,
    coalesce(CASE jsonb_typeof(raw->'industry') WHEN 'object' THEN coalesce(raw->'industry'->>'label', raw->'industry'->>'id') WHEN 'string' THEN raw->>'industry' ELSE (raw->'industry')::text END, '') valeur
  FROM p WHERE raw ? 'industry'
  UNION ALL
  SELECT "companyId", name, "sourceKey", kind, 'sectors', coalesce(s->>'reference', '') || ' < ' || coalesce(s->>'parent_reference', '') || ' (' || coalesce(s->>'name', '') || ')'
  FROM p, jsonb_array_elements(CASE WHEN jsonb_typeof(raw->'sectors') = 'array' THEN raw->'sectors' ELSE '[]'::jsonb END) s WHERE raw ? 'sectors'
  UNION ALL
  SELECT "companyId", name, "sourceKey", kind, 'businessGroup', coalesce(raw->>'businessGroup', '') FROM p WHERE raw ? 'businessGroup')
SELECT row_to_json(x) FROM (SELECT "companyId", name, "sourceKey", kind, champ, valeur, count(*)::int n FROM v GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 1, 7 DESC) x;

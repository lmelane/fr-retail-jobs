-- LECTURE SEULE. ÉNUMÉRATION RÉELLE des clés de `raw`, ATS par ATS.
-- Ne devine AUCUNE liste : jsonb_object_keys d'abord, jugement ensuite.
-- Échantillon borné (400 offres/ATS) pour rester lisible, tiré des actives.
-- Rejouable : node audits/mesures-d435-d436/q.mjs --file <ce fichier>
WITH ech AS (
  SELECT source, raw,
         row_number() OVER (PARTITION BY source ORDER BY id) AS rn
  FROM "Job"
  WHERE "isActive" = true AND "mergedIntoId" IS NULL
    AND raw IS NOT NULL AND jsonb_typeof(raw) = 'object'
),
b AS (SELECT source, raw FROM ech WHERE rn <= 400),
k AS (
  SELECT source::text AS ats, jsonb_object_keys(raw) AS cle, count(*) OVER (PARTITION BY source) AS dummy
  FROM b
)
SELECT ats, count(DISTINCT cle)::int AS nb_cles_distinctes,
       string_agg(DISTINCT cle, ', ' ORDER BY cle) AS cles
FROM k
GROUP BY ats
ORDER BY ats

-- LECTURE SEULE. Inventaire : volume par ATS et par marché, offres ACTIVES.
-- Rejouable : node audits/mesures-d435-d436/q.mjs --file audits/mesures-d435-d436/lot5-inventaire-2026-09-15.sql
SELECT
  source::text                                    AS ats,
  count(*)::int                                   AS actives,
  count(DISTINCT "countryCode")::int              AS pays_distincts,
  count(*) FILTER (WHERE "countryCode" IN ('US','FR','GB','CA','DE','IT','ES','NL','AU','CH','BE','CN'))::int AS dans_registre,
  count(*) FILTER (WHERE raw IS NOT NULL)::int    AS avec_raw
FROM "Job"
WHERE "isActive" = true AND "mergedIntoId" IS NULL
GROUP BY source
ORDER BY actives DESC

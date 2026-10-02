-- R-143 §3 (D-513) — passage À BLANC de l'autorité de la source officielle, LECTURE SEULE sur la production.
-- Rejouer (jamais entre 15:30 et 18:30 UTC) :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F" | " -f <ce fichier>'
-- A1 reproduit le rattrapage de la migration 20261002140000 (publisherClosedAt des représentations désactivées sur
-- preuve par le refresh, non revues depuis) puis la règle `authorityClosure` (packages/db/publications.ts) : une offre
-- active dont une représentation officielle (EMPLOYER_DIRECT, GROUP_OFFICIAL, ATS_OFFICIAL) a une fin prouvée par sa
-- source (ou une échéance atteinte) et est de rang STRICTEMENT supérieur à toutes ses représentations disponibles.
-- A3 rejoue Q16 de comparaison-indeed : les jumeaux WTTJ hors regroupement (autre offre, même Maison/intitulé/ville).
\timing on
SET statement_timeout = '180s';
SHOW default_transaction_read_only;

\echo A1 offres que l autorite fermerait au prochain refresh, par source fermee et source qui les garde
WITH r(tier, rk) AS (VALUES ('EMPLOYER_DIRECT', 0), ('GROUP_OFFICIAL', 1), ('ATS_OFFICIAL', 2), ('SPECIALIST_JOBBOARD', 3), ('AGGREGATOR', 4)),
preuve AS (
  SELECT DISTINCT ON (d.id) d.id, dc."createdAt" at FROM "DataCorrection" dc
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(dc.evidence->'deactivatedIds') = 'array' THEN dc.evidence->'deactivatedIds' ELSE '[]'::jsonb END) d(id)
  WHERE dc.finding = 'REFRESH_LIFECYCLE' AND dc.evidence->>'outcome' = 'APPLIED' ORDER BY d.id, dc."createdAt" DESC),
rep AS (
  SELECT js.*, rk.rk, (js."isActive" AND (js."expiresAt" IS NULL OR js."expiresAt" > (now() AT TIME ZONE 'UTC'))) dispo,
    (NOT js."isActive" AND p.at IS NOT NULL AND js."lastSeenAt" < p.at) OR (js."expiresAt" IS NOT NULL AND js."expiresAt" <= (now() AT TIME ZONE 'UTC')) fin_prouvee
  FROM "JobSource" js JOIN r rk ON rk.tier = js."sourceTier" LEFT JOIN preuve p ON p.id = js.id),
j AS (
  SELECT j.id, j."countryCode", j."canonicalSourceKey", min(rep.rk) FILTER (WHERE rep.dispo) meilleur_dispo,
    min(rep.rk) FILTER (WHERE NOT rep.dispo AND rep.fin_prouvee AND rep.rk <= 2) meilleure_fin,
    (array_agg(rep."sourceKey" ORDER BY rep.rk) FILTER (WHERE NOT rep.dispo AND rep.fin_prouvee AND rep.rk <= 2))[1] fermee_par
  FROM "Job" j JOIN rep ON rep."jobId" = j.id WHERE j."isActive" AND j."mergedIntoId" IS NULL GROUP BY j.id)
SELECT fermee_par, "canonicalSourceKey" garde, count(*) offres, count(*) FILTER (WHERE "countryCode" IS NOT NULL) servies
FROM j WHERE meilleure_fin IS NOT NULL AND meilleur_dispo IS NOT NULL AND meilleure_fin < meilleur_dispo GROUP BY 1,2 ORDER BY 3 DESC;

\echo A2 offres de A1 a echeance seulement (sans preuve d absence)
WITH r(tier, rk) AS (VALUES ('EMPLOYER_DIRECT', 0), ('GROUP_OFFICIAL', 1), ('ATS_OFFICIAL', 2), ('SPECIALIST_JOBBOARD', 3), ('AGGREGATOR', 4))
SELECT count(DISTINCT j.id) FROM "Job" j JOIN "JobSource" e ON e."jobId" = j.id AND e."sourceTier" IN ('EMPLOYER_DIRECT','GROUP_OFFICIAL','ATS_OFFICIAL') AND e."expiresAt" <= (now() AT TIME ZONE 'UTC')
JOIN r re ON re.tier = e."sourceTier"
WHERE j."isActive" AND j."mergedIntoId" IS NULL AND NOT EXISTS (SELECT 1 FROM "JobSource" o JOIN r ro ON ro.tier = o."sourceTier" WHERE o."jobId" = j.id AND o."isActive" AND (o."expiresAt" IS NULL OR o."expiresAt" > (now() AT TIME ZONE 'UTC')) AND ro.rk <= re.rk)
  AND EXISTS (SELECT 1 FROM "JobSource" o WHERE o."jobId" = j.id AND o."isActive" AND (o."expiresAt" IS NULL OR o."expiresAt" > (now() AT TIME ZONE 'UTC')));

\echo A3 jumeaux WTTJ hors regroupement (Q16 de comparaison-indeed) : hors de la regle, faute d identite commune
WITH n AS (SELECT j.id, j."companyId", j."canonicalTier" tier, j."isActive" act, j."closedAt",
        lower(regexp_replace(translate(lower(j.title), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ', 'aaaaaaceeeeiiiinooooouuuuyyoa'), '[^a-z0-9]+', ' ', 'g')) t, lower(coalesce(j.city, '')) c
      FROM "Job" j WHERE j."mergedIntoId" IS NULL AND j.city IS NOT NULL),
w AS (SELECT * FROM n WHERE tier = 'SPECIALIST_JOBBOARD' AND act AND EXISTS (SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = n.id AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now())))
SELECT count(*) AS wttj_servies,
  count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM n o WHERE o."companyId" = w."companyId" AND o.t = w.t AND o.c = w.c AND o.tier <> 'SPECIALIST_JOBBOARD' AND o.act)
                   AND EXISTS (SELECT 1 FROM n o WHERE o."companyId" = w."companyId" AND o.t = w.t AND o.c = w.c AND o.tier <> 'SPECIALIST_JOBBOARD' AND NOT o.act AND o."closedAt" > now() - interval '60 days')) AS jumeau_officiel_ferme_seulement
FROM w;

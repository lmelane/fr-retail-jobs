-- D-520, classe identité d'employeur. LECTURE SEULE de la production, hors fenêtre du RUN (avant 15:30 ou après 18:30 UTC).
-- Registre (maison, périmètre, rang) des 27 sources et leurs libellés observés depuis le 01/09. Mesuré le 02/10 à 14:54 UTC.
-- Rejeu, depuis le checkout qui porte les accès :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -XA -F'|' -v ON_ERROR_STOP=1 -f <worktree>/audits/2026-10-02/classe-identite/sources.sql' > <worktree>/audits/2026-10-02/classe-identite/sources.out
\pset footer off
SET statement_timeout='120s';
\set srcs '''aptar-beauty'',''avolta'',''beauty-success-geodir'',''brown-thomas-taleo'',''browns'',''crocs'',''drunk-elephant-2'',''escada-parfums-16'',''groupe-printemps'',''hot-topic'',''lagardere-duty-free'',''lagardere-travel-retail'',''lagardere-travel-retail-de'',''luxe-talent'',''lvmh'',''monoprix'',''prada-group'',''rivoli-typesense'',''sephora-france'',''tiffany-oracle'',''b-s-international'',''funky-buddha'',''puma'',''richemont'',''richemont-workday'',''swatch-group'',''tapestry'''
SELECT key, maison, kind, "portalScope", status, tier, "careersDomain", "currentRevisionId" IS NOT NULL rev FROM "Source" WHERE key IN (:srcs) ORDER BY key;
SELECT o."sourceKey", o."labelOrigin", o.rule, o."normalizedEmployerName", count(DISTINCT o."externalId") n
FROM "EmployerObservation" o WHERE o."sourceKey" IN (:srcs) AND o."observedAt" >= '2026-09-01'
GROUP BY 1,2,3,4 ORDER BY 1,5 DESC;

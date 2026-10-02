-- D-510 — la première page sans critère, triée par fraîcheur (Catwalks d'abord, puis LEAST(postedAt, firstSeenAt), puis
-- l'identifiant) : combien de Maisons distinctes, et la plus représentée ? (le « mur H&M » de D-419 : 24 cartes sur 25).
-- Lecture seule : python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -v marche="'"'FR'"'" -f …'
\pset footer off
WITH offres AS (
  SELECT 1 AS origine, j.id, c.name AS maison, LEAST(j."postedAt", j."firstSeenAt") AS f, j."countryCode" AS pays
  FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id AND a."isActive"
    AND (a."expiresAt" IS NULL OR a."expiresAt" > (now() AT TIME ZONE 'UTC')))
  UNION ALL
  SELECT 0, 'cw_' || d.id, COALESCE(dc.name, d.company), LEAST(d."postedAt", d."receivedAt"), d."countryCode"
  FROM "DirectOffer" d LEFT JOIN "Company" dc ON dc.id = d."companyId"
  WHERE d.eligible AND (d."validThrough" IS NULL OR d."validThrough" > (now() AT TIME ZONE 'UTC'))
), pages AS (
  SELECT m.marche, o.*, row_number() OVER (PARTITION BY m.marche ORDER BY o.origine, o.f DESC, o.id) AS rang
  FROM (VALUES ('FR', ARRAY['FR']), ('US', ARRAY['US']), ('GB', ARRAY['GB','IE']), ('DE', ARRAY['DE','AT'])) m(marche, pays)
  JOIN offres o ON o.pays = ANY(m.pays)
)
SELECT marche, count(*) FILTER (WHERE origine = 0) AS catwalks,
  count(DISTINCT maison) AS maisons_distinctes,
  (SELECT p2.maison || ' (' || count(*) || ')' FROM pages p2 WHERE p2.marche = p.marche AND p2.rang <= 25 AND p2.origine = 1
     GROUP BY p2.maison ORDER BY count(*) DESC LIMIT 1) AS maison_la_plus_presente,
  min(f)::date AS plus_ancienne_de_la_page
FROM pages p WHERE rang <= 25 GROUP BY marche ORDER BY marche;

-- La même page dans l'ordre d'avant D-510 (contrat 2 sans critère : Catwalks, pays du visiteur — ici le premier pays du
-- marché —, date de publication décroissante, sans date en dernier, première observation, identifiant).
WITH offres AS (
  SELECT 1 AS origine, j.id, c.name AS maison, j."postedAt" AS p, j."firstSeenAt" AS v, j."countryCode" AS pays
  FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id AND a."isActive"
    AND (a."expiresAt" IS NULL OR a."expiresAt" > (now() AT TIME ZONE 'UTC')))
  UNION ALL
  SELECT 0, 'cw_' || d.id, COALESCE(dc.name, d.company), d."postedAt", d."receivedAt", d."countryCode"
  FROM "DirectOffer" d LEFT JOIN "Company" dc ON dc.id = d."companyId"
  WHERE d.eligible AND (d."validThrough" IS NULL OR d."validThrough" > (now() AT TIME ZONE 'UTC'))
), pages AS (
  SELECT m.marche, o.*, row_number() OVER (PARTITION BY m.marche ORDER BY o.origine, (o.pays <> m.pays[1])::int,
    o.p DESC NULLS LAST, o.v DESC, o.id) AS rang
  FROM (VALUES ('FR', ARRAY['FR']), ('US', ARRAY['US']), ('GB', ARRAY['GB','IE']), ('DE', ARRAY['DE','AT'])) m(marche, pays)
  JOIN offres o ON o.pays = ANY(m.pays)
)
SELECT marche, count(*) FILTER (WHERE origine = 0) AS catwalks, count(DISTINCT maison) AS maisons_distinctes,
  (SELECT p2.maison || ' (' || count(*) || ')' FROM pages p2 WHERE p2.marche = p.marche AND p2.rang <= 25 AND p2.origine = 1
     GROUP BY p2.maison ORDER BY count(*) DESC LIMIT 1) AS maison_la_plus_presente
FROM pages p WHERE rang <= 25 GROUP BY marche ORDER BY marche;

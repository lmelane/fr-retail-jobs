-- D-510 — la clé de fraîcheur : que vaut `postedAt` sur les offres SERVIES ? Lecture seule.
-- Rejouer : python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f audits/2026-10-02/fraicheur-d510/mesure-postedat.sql'
-- Population : les offres agrégées publiques (même prédicat que `publicJobSql`) et les offres directes publiables.
\pset footer off
WITH pub AS (
  SELECT j.id, j."postedAt", j."firstSeenAt", j."countryCode",
    (SELECT split_part(s."sourceKey", ':', 1) FROM "JobSource" s WHERE s."jobId" = j.id AND s."isActive" ORDER BY s."sourceKey" LIMIT 1) AS famille
  FROM "Job" j
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id AND a."isActive"
    AND (a."expiresAt" IS NULL OR a."expiresAt" > (now() AT TIME ZONE 'UTC')))
)
SELECT count(*) AS offres,
  count(*) FILTER (WHERE "postedAt" IS NULL) AS sans_date,
  round(100.0 * count(*) FILTER (WHERE "postedAt" IS NULL) / count(*), 1) AS pct_sans_date,
  count(*) FILTER (WHERE "postedAt" > (now() AT TIME ZONE 'UTC')) AS futures,
  count(*) FILTER (WHERE "postedAt" > (now() AT TIME ZONE 'UTC') + interval '1 day') AS futures_plus_1j,
  count(*) FILTER (WHERE "postedAt" > "firstSeenAt" + interval '1 day') AS apres_premiere_vue_plus_1j,
  count(*) FILTER (WHERE "postedAt" < '2015-01-01') AS avant_2015,
  count(*) FILTER (WHERE "postedAt" < (now() AT TIME ZONE 'UTC') - interval '365 days') AS plus_d_un_an,
  min("postedAt") AS plus_ancienne, max("postedAt") AS plus_recente,
  min("firstSeenAt") AS premiere_vue_min, max("firstSeenAt") AS premiere_vue_max
FROM pub;

-- Par famille de source : la part sans date, et l'âge de leur première observation.
WITH pub AS (
  SELECT j.id, j."postedAt", j."firstSeenAt",
    (SELECT split_part(s."sourceKey", ':', 1) FROM "JobSource" s WHERE s."jobId" = j.id AND s."isActive" ORDER BY s."sourceKey" LIMIT 1) AS famille
  FROM "Job" j
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id AND a."isActive"
    AND (a."expiresAt" IS NULL OR a."expiresAt" > (now() AT TIME ZONE 'UTC')))
)
SELECT famille, count(*) AS offres, count(*) FILTER (WHERE "postedAt" IS NULL) AS sans_date,
  round(100.0 * count(*) FILTER (WHERE "postedAt" IS NULL) / count(*), 1) AS pct,
  count(*) FILTER (WHERE "postedAt" > "firstSeenAt" + interval '1 day') AS apres_vue,
  count(*) FILTER (WHERE "postedAt" > (now() AT TIME ZONE 'UTC')) AS futures
FROM pub GROUP BY famille ORDER BY offres DESC LIMIT 25;

-- Les offres sans date : quand sont-elles entrées au catalogue ? (un `firstSeenAt` récent les ferait passer pour fraîches)
WITH pub AS (
  SELECT j."postedAt", j."firstSeenAt" FROM "Job" j
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id AND a."isActive"
    AND (a."expiresAt" IS NULL OR a."expiresAt" > (now() AT TIME ZONE 'UTC')))
)
SELECT date_trunc('day', "firstSeenAt")::date AS jour, count(*) FILTER (WHERE "postedAt" IS NULL) AS sans_date, count(*) AS toutes
FROM pub GROUP BY 1 ORDER BY 1 DESC LIMIT 20;

-- L'écart entre la publication et la première observation, quand la date existe (quantiles en jours).
WITH pub AS (
  SELECT j."postedAt", j."firstSeenAt" FROM "Job" j
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."postedAt" IS NOT NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id AND a."isActive"
    AND (a."expiresAt" IS NULL OR a."expiresAt" > (now() AT TIME ZONE 'UTC')))
)
SELECT percentile_disc(ARRAY[0.01, 0.1, 0.5, 0.9, 0.99]) WITHIN GROUP (ORDER BY extract(epoch FROM "firstSeenAt" - "postedAt") / 86400) AS ecart_jours
FROM pub;

-- Offres directes publiables.
SELECT count(*) AS directes, count(*) FILTER (WHERE "postedAt" IS NULL) AS sans_date,
  count(*) FILTER (WHERE "postedAt" > (now() AT TIME ZONE 'UTC')) AS futures,
  count(*) FILTER (WHERE "postedAt" > "receivedAt" + interval '1 day') AS apres_reception
FROM "DirectOffer" d WHERE d.eligible AND (d."validThrough" IS NULL OR d."validThrough" > (now() AT TIME ZONE 'UTC'));

-- Les offres sans date, par marché et par jour d'entrée, face aux offres datées plus récentes que leur entrée : combien
-- d'offres datées passent devant elles, combien de datées plus anciennes elles enterrent (clé LEAST(postedAt, firstSeenAt)).
WITH pub AS (
  SELECT j."countryCode" AS pays, j."postedAt", j."firstSeenAt", LEAST(j."postedAt", j."firstSeenAt") AS f FROM "Job" j
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "JobSource" a WHERE a."jobId" = j.id AND a."isActive"
    AND (a."expiresAt" IS NULL OR a."expiresAt" > (now() AT TIME ZONE 'UTC')))
), sans AS (SELECT pays, count(*) AS n, min(f) AS f_min, max(f) AS f_max FROM pub WHERE "postedAt" IS NULL GROUP BY pays)
SELECT s.pays, s.n AS sans_date, s.f_min::date, s.f_max::date,
  (SELECT count(*) FROM pub p WHERE p.pays = s.pays AND p."postedAt" IS NOT NULL AND p.f > s.f_max) AS datees_devant,
  (SELECT count(*) FROM pub p WHERE p.pays = s.pays AND p."postedAt" IS NOT NULL AND p.f < s.f_min) AS datees_derriere,
  (SELECT count(*) FROM pub p WHERE p.pays = s.pays) AS offres_du_pays
FROM sans s ORDER BY s.n DESC LIMIT 12;

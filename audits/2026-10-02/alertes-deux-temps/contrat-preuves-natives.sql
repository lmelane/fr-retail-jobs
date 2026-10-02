-- D-515 §3 — OÙ L'INTENTION D'EMPLOI PERMANENT EST DITE SANS ÊTRE LUE : les champs natifs (payload de la source) des offres
-- servies sans durée reconnue. LECTURE SEULE. Jamais entre 15:30 et 18:30 UTC. Rejouer comme contrat-par-marche.sql.
SET statement_timeout = '240s';
\set servie 'SELECT j.id, j."countryCode", j."canonicalSourceKey", j."canonicalExternalId", j."employmentTerm", j."workTime", j."rawContract", j.title, CASE WHEN j."countryCode" IN (''FR'',''MC'') THEN ''FR'' WHEN j."countryCode" IN (''GB'',''IE'') THEN ''GB'' WHEN j."countryCode" IN (''DE'',''AT'') THEN ''DE'' ELSE j."countryCode" END AS marche FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."employmentTerm" IS NULL AND j."countryCode" IN (''JP'',''KR'',''PT'',''MX'',''SG'',''DK'',''HK'',''PL'',''SE'',''CL'',''TR'',''TH'',''MY'',''AE'',''NO'',''TW'',''BR'',''GR'',''ZA'',''VN'',''CZ'',''PE'',''NZ'',''HU'',''SA'',''RO'',''PR'',''PH'',''LU'',''US'',''FR'',''MC'',''GB'',''IE'',''CA'',''DE'',''AT'',''IT'',''ES'',''NL'',''AU'',''CH'',''BE'',''CN'') AND EXISTS (SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = j.id AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now()))'

-- P1 : les paires (clé, valeur) du payload natif dont la VALEUR nomme une durée permanente dans une langue servie, sur les
-- offres sans durée reconnue : quelle clé, quelle valeur, combien, sur quels marchés.
SELECT kv.key AS cle, left(kv.value, 60) AS valeur, count(DISTINCT s.id) n, string_agg(DISTINCT s.marche, ',') marches,
  string_agg(DISTINCT split_part(s."canonicalSourceKey", ':', 1), ',') sources
FROM (:servie) s
JOIN "JobSource" js ON js."jobId" = s.id AND js."sourceKey" = s."canonicalSourceKey" AND js."externalId" = s."canonicalExternalId"
CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(js.raw) = 'object' THEN js.raw ELSE '{}'::jsonb END) kv
WHERE length(kv.value) <= 80 AND kv.value ~* '(\mregular\M|\mpermanent\M|unbefristet|indefinid|indeterminat|\mcdi\M|festanstellung|\mvast\M|efetiv|正社員|정규직|tillsvidare|\mfast\M)'
GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 60;

-- P2 : le libellé brut « Permanent » / « Regular » non lu (FR 151 au Q2 de contrat-par-marche.sql) : quelle source.
SELECT s.marche, s."rawContract", split_part(s."canonicalSourceKey", ':', 1) famille, s."canonicalSourceKey", count(*) n
FROM (:servie) s WHERE s."rawContract" ~* '(\mregular\M|\mpermanent\M|unbefristet|indefinid|\mcdi\M)'
GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC LIMIT 30;

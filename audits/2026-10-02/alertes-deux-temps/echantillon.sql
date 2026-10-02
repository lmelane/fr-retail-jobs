-- R-143 §6 — l'échantillon rejoué : 1 offre servie sur 8 (md5 de l'identifiant commençant par 0 ou 1), avec les entrées de
-- la reconnaissance (intitulé brut, description, contrat et temps de travail de l'adaptateur, RAW de la publication
-- propriétaire). LECTURE SEULE, jamais entre 15:30 et 18:30 UTC. Réextrait pour D-515 §3 le 02/10/2026.
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -q -A -t' < echantillon.sql > echantillon.jsonl
-- (format texte de COPY : déséchapper les barres obliques inverses avant de lire le JSON, cf. comparer-rejeu.py.)
-- Puis : npx tsx rejeu-contrat.mts <code avant|après> echantillon.json.jsonl rejeu-<x>.json ; python3 comparer-rejeu.py … ; python3 relecture-30.py …
SET statement_timeout='170s';
COPY (SELECT json_build_object('id', j.id,
  'marche', CASE WHEN j."countryCode" IN ('FR','MC') THEN 'FR' WHEN j."countryCode" IN ('GB','IE') THEN 'GB' WHEN j."countryCode" IN ('DE','AT') THEN 'DE' ELSE j."countryCode" END,
  'fournisseur', coalesce(s.kind,'?'), 'sourceKey', j."canonicalSourceKey", 'title', coalesce(j."rawTitle", j.title), 'description', j.description,
  'contract', j."rawContract", 'workingTime', j."rawWorkingTime", 'raw', js.raw,
  'employmentTerm', j."employmentTerm", 'programType', j."programType", 'engagementType', j."engagementType", 'workTime', j."workTime")
FROM "Job" j LEFT JOIN "Source" s ON s.key = j."canonicalSourceKey"
LEFT JOIN "JobSource" js ON js."jobId"=j.id AND js."sourceKey"=j."canonicalSourceKey" AND js."externalId"=j."canonicalExternalId"
WHERE j."isActive" AND j."mergedIntoId" IS NULL AND substr(md5(j.id),1,1) IN ('0','1')
  AND j."countryCode" IN ('JP','KR','PT','MX','SG','DK','HK','PL','SE','CL','TR','TH','MY','AE','NO','TW','BR','GR','ZA','VN','CZ','PE','NZ','HU','SA','RO','PR','PH','LU','US','FR','MC','GB','IE','CA','DE','AT','IT','ES','NL','AU','CH','BE','CN')
  AND EXISTS (SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = j.id AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now()))) TO STDOUT;

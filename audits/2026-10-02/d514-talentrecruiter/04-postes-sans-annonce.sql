-- D-514 §4 : les publications GANNI dont la dernière observation ne porte aucune annonce (Advertisements vide ou sans
-- contenu), leur type natif, leur état de publication, et si le Job lié est servi (lecture seule).
\pset pager off
SELECT js."externalId", left(js.title,45) titre, js.raw->'position'->>'ProjectType' type,
  jsonb_array_length(coalesce(js.raw->'position'->'Advertisements','[]'::jsonb)) annonces,
  js.raw->'fieldEvidence'->>'description' preuve_desc,
  js."isActive" actif, js."quarantinedAt" is not null quarantaine, to_char(js."firstSeenAt",'MM-DD HH24:MI') vu_le, to_char(js."lastSeenAt",'MM-DD HH24:MI') revu_le,
  j."isActive" job_actif, j.description is null or btrim(j.description)='' job_sans_desc
FROM "JobSource" js LEFT JOIN "Job" j ON j.id=js."jobId"
WHERE js."sourceKey"='ganni-talentrecruiter'
  AND (js.raw->'fieldEvidence'->>'description' = 'NO_CONTENT_PUBLISHED' OR jsonb_array_length(coalesce(js.raw->'position'->'Advertisements','[]'::jsonb))=0)
ORDER BY js."lastSeenAt" DESC;
SELECT count(*) total, count(*) FILTER (WHERE js."isActive") actives FROM "JobSource" js WHERE js."sourceKey"='ganni-talentrecruiter';

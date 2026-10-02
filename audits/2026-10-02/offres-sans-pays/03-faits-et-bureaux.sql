-- Pour chaque source portant des offres sans pays : sourceFacts.locations (ce que l'adaptateur a lu) et les champs
-- natifs complets offices (Greenhouse) / jobLocation (JSON-LD) / _jobposting.jobLocation d'une représentation.
with sp as (
  select j.id, j."canonicalSourceKey" src from "Job" j where j."isActive" and j."mergedIntoId" is null and j."countryCode" is null
    and exists (select 1 from "JobSource" s where s."jobId"=j.id and s."isActive" and (s."expiresAt" is null or s."expiresAt" > now()))
), un as (
  select distinct on (sp.src) sp.src, s.raw, s."sourceFacts"
  from sp join "JobSource" s on s."jobId"=sp.id and s."isActive" order by sp.src, s."lastSeenAt" desc
)
select src, left(("sourceFacts"->'locations')::text, 600) faits,
  left(coalesce(raw->'offices', raw->'jobLocation', raw->'_jobposting'->'jobLocation', raw->'cells', raw->'bulletFields', raw->'listing')::text, 600) natif
from un order by src;

-- Pour chaque source portant des offres sans pays : une représentation active, ses champs bruts de lieu
-- (clés du RAW dont le nom évoque un lieu ou un pays) et le lieu de sourceFacts.
with sp as (
  select j.id, j."canonicalSourceKey" src from "Job" j where j."isActive" and j."mergedIntoId" is null and j."countryCode" is null
    and exists (select 1 from "JobSource" s where s."jobId"=j.id and s."isActive" and (s."expiresAt" is null or s."expiresAt" > now()))
), un as (
  select distinct on (sp.src) sp.src, s."sourceKey", s.raw, s."sourceFacts"
  from sp join "JobSource" s on s."jobId"=sp.id and s."isActive" order by sp.src, s."lastSeenAt" desc
)
select src, "sourceKey",
  (select string_agg(k, ',') from jsonb_object_keys(case when jsonb_typeof(raw)='object' then raw else '{}'::jsonb end) k) cles,
  (select jsonb_object_agg(k, left(v::text, 160)) from jsonb_each(case when jsonb_typeof(raw)='object' then raw else '{}'::jsonb end) e(k,v)
     where k ~* '(countr|pays|location|locat|city|ville|region|state|address|addr|place|site|store|geo|lat|lon|market|nation|iso)') lieu_brut,
  left(("sourceFacts"->'location')::text, 400) faits_lieu,
  (select string_agg(k, ',') from jsonb_object_keys(case when jsonb_typeof("sourceFacts")='object' then "sourceFacts" else '{}'::jsonb end) k) cles_faits
from un order by src;

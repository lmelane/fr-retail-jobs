-- Ce que la source sait par ailleurs : la répartition par pays de ses autres offres actives, son domaine, sa config.
with srcs as (
  select distinct j."canonicalSourceKey" k from "Job" j where j."isActive" and j."mergedIntoId" is null and j."countryCode" is null
    and exists (select 1 from "JobSource" s where s."jobId"=j.id and s."isActive" and (s."expiresAt" is null or s."expiresAt" > now()))
)
-- La config est relue telle quelle ; une clé d'API publique de recherche (rivoli-typesense) est masquée dans le .out.
select s.key, s.kind, s."careersDomain", s."portalScope", s.status,
  (select jsonb_object_agg(coalesce(c,'∅'), n) from (select j."countryCode" c, count(*) n from "Job" j
     where j."canonicalSourceKey"=s.key and j."isActive" and j."mergedIntoId" is null group by 1) x) pays_des_offres,
  left(s.config::text, 300) config
from "Source" s join srcs on srcs.k = s.key order by s.key;

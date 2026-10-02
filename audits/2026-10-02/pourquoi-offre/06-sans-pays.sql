-- Offres servies sans pays (HORS_MARCHE/SANS_PAYS) : par source canonique, avec un exemple de lieu (lecture seule, production).
select j."canonicalSourceKey", count(*) n, (array_agg(distinct j.city))[1:4] villes
from "Job" j where j."isActive" and j."mergedIntoId" is null and j."countryCode" is null
  and exists (select 1 from "JobSource" s where s."jobId"=j.id and s."isActive" and (s."expiresAt" is null or s."expiresAt" > now()))
group by 1 order by 2 desc limit 15;

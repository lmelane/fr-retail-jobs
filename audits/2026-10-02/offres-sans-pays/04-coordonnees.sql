-- Offres sans pays portant des coordonnées natives : étendue des points, et combien tombent hors du rectangle
-- des îles Britanniques (lat 49,8–60,9 ; lon −8,7–1,8), et hors (0,0). geoCityId déjà posé ?
with sp as (
  select j.id, j."canonicalSourceKey" src, j.latitude, j.longitude, j."geoCityId", j."geoSource"
  from "Job" j where j."isActive" and j."mergedIntoId" is null and j."countryCode" is null
    and exists (select 1 from "JobSource" s where s."jobId"=j.id and s."isActive" and (s."expiresAt" is null or s."expiresAt" > now()))
)
select src, count(*) n, count(*) filter (where "geoCityId" is not null) geo_city, count(*) filter (where latitude is not null) coord,
  min(latitude), max(latitude), min(longitude), max(longitude),
  count(*) filter (where latitude is not null and not (latitude between 49.8 and 60.9 and longitude between -8.7 and 1.8)) hors_rect_gb,
  count(*) filter (where latitude is not null and latitude between 51.4 and 55.5 and longitude between -10.6 and -5.4) zone_irlande
from sp group by src having count(*) filter (where latitude is not null) > 0 order by 2 desc;

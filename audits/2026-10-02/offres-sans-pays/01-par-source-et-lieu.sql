-- Offres servies sans pays (HORS_MARCHE/SANS_PAYS, même prédicat que pourquoi-offre/06) : par source, lieu brut,
-- ville, subdivision, et résolution de la ville dans GeoCityName (nombre de pays distincts portant ce nom).
with sp as (
  select j.id, j."canonicalSourceKey" src, j.location, j.city, j."adminArea1", j."postalCode", j.latitude, j.longitude
  from "Job" j where j."isActive" and j."mergedIntoId" is null and j."countryCode" is null
    and exists (select 1 from "JobSource" s where s."jobId"=j.id and s."isActive" and (s."expiresAt" is null or s."expiresAt" > now()))
), g as (
  select sp.*, (select count(distinct n."countryCode") from "GeoCityName" n where n."nameKey" = catwalks_lieu_cle(sp.city)) pays_ville,
         (select string_agg(distinct n."countryCode", ',') from "GeoCityName" n where n."nameKey" = catwalks_lieu_cle(sp.city)) codes
  from sp
)
select src, count(*) n,
  count(*) filter (where city is null) sans_ville,
  count(*) filter (where pays_ville = 1) ville_un_pays,
  count(*) filter (where pays_ville > 1) ville_ambigue,
  count(*) filter (where city is not null and pays_ville = 0) ville_inconnue,
  count(*) filter (where latitude is not null) avec_coord,
  (array_agg(distinct coalesce(location,'∅')||' | '||coalesce(city,'∅')||' | '||coalesce("adminArea1",'∅')||' → '||coalesce(codes,'-')))[1:5] exemples
from g group by 1 order by 2 desc;

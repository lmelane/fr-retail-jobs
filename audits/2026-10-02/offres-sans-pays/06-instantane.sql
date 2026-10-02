-- Instantané des offres servies sans pays (même prédicat que pourquoi-offre/06), une ligne JSON par offre : lieu brut,
-- ville, coordonnées, représentation canonique (champs natifs de lieu, faits de lieu), et les pays où GeoNames connaît
-- la clé de la ville (GeoCityName). Sert à concevoir la résolution hors fenêtre ; la mesure à blanc relit la base.
\pset tuples_only on
\pset format unaligned
with sp as (
  select j.id, j."canonicalSourceKey" src, j."canonicalExternalId" ext, j.location, j.city, j."adminArea1", j."postalCode", j.latitude, j.longitude
  from "Job" j where j."isActive" and j."mergedIntoId" is null and j."countryCode" is null
    and exists (select 1 from "JobSource" s where s."jobId"=j.id and s."isActive" and (s."expiresAt" is null or s."expiresAt" > now()))
)
select jsonb_build_object('id', sp.id, 'src', sp.src, 'location', sp.location, 'city', sp.city, 'admin', sp."adminArea1",
  'postal', sp."postalCode", 'lat', sp.latitude, 'lon', sp.longitude,
  'cityCountries', (select coalesce(jsonb_agg(distinct n."countryCode"), '[]') from "GeoCityName" n where n."nameKey" = catwalks_lieu_cle(sp.city)),
  'offices', s.raw->'offices', 'rawCountry', s.raw->'country', 'jobLocation', coalesce(s.raw->'jobLocation', s.raw->'_jobposting'->'jobLocation', s.raw->'jsonLd'->'jobLocation'),
  'factsLocations', s."sourceFacts"->'locations')::text
from sp left join "JobSource" s on s."sourceKey" = sp.src and s."externalId" = sp.ext;

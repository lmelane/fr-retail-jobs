-- Prémisses de la conception (lecture seule, production, 02/10/2026). Rejouable : db.py readonly psql -f.
\echo '== offres actives : représentation disponible ? pays ?'
select (exists (select 1 from "JobSource" s where s."jobId"=j.id and s."isActive" and (s."expiresAt" is null or s."expiresAt" > now()))) as disponible,
       (j."countryCode" is null) as sans_pays, count(*)
from "Job" j where j."isActive" and j."mergedIntoId" is null group by 1,2 order by 1,2;
\echo '== offres actives sans représentation active du tout'
select count(*) from "Job" j where j."isActive" and not exists (select 1 from "JobSource" s where s."jobId"=j.id and s."isActive");
\echo '== offres fermées : preuves lisibles sur les représentations'
select bool_or(s."expiresAt" is not null and s."expiresAt" <= j."closedAt" + interval '1 minute') as echeance,
       bool_or(s."isActive") as une_rep_active, count(distinct j.id)
from "Job" j join "JobSource" s on s."jobId"=j.id where not j."isActive" and j."closedAt" is not null group by 1,2 order by 1,2;
\echo '== statut de la source des représentations actives des offres actives'
select coalesce(src.status::text,'(absente du registre)') st, count(distinct s."jobId") from "JobSource" s join "Job" j on j.id=s."jobId" left join "Source" src on src.key=s."sourceKey"
where j."isActive" and s."isActive" group by 1 order by 2 desc;
\echo '== retraits : motif et dernière retenue observée'
select j."withdrawalReason", (select o."publicationHold" from "SourceObservation" o join "JobSource" s on s."sourceKey"=o."sourceKey" and s."externalId"=o."externalId" where s."jobId"=j.id and o."publicationHold" is not null order by o."observedAt" desc limit 1) hold, count(*)
from "Job" j where not j."isActive" and j."withdrawnAt" is not null group by 1,2;
\echo '== publications retenues jamais publiées (dernière observation par paire, 7 jours)'
select o."publicationHold", count(distinct (o."sourceKey", o."externalId")) from "SourceObservation" o where o."publicationHold" is not null and o."observedAt" > now() - interval '7 days'
 and not exists (select 1 from "JobSource" s where s."sourceKey"=o."sourceKey" and s."externalId"=o."externalId") group by 1 order by 2 desc;
\echo '== pays des offres servies hors marchés ouverts (top)'
select j."countryCode", count(*) from "Job" j where j."isActive" and j."mergedIntoId" is null and exists (select 1 from "JobSource" s where s."jobId"=j.id and s."isActive" and (s."expiresAt" is null or s."expiresAt" > now()))
 group by 1 order by 2 desc;

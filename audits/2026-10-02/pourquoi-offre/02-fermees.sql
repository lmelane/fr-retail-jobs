-- Offres fermées : quelle preuve lisible porte chacune (lecture seule, production, 02/10/2026).
with f as (select j.id, j."closedAt",
  bool_or(s."expiresAt" is not null and s."expiresAt" <= j."closedAt" + interval '1 minute') as echeance,
  bool_or(s."isActive") as une_rep_active
  from "Job" j join "JobSource" s on s."jobId"=j.id where not j."isActive" and j."closedAt" is not null group by j.id, j."closedAt")
select echeance, une_rep_active, count(*), min("closedAt"), max("closedAt") from f group by 1,2 order by 1,2;
\echo '== offres actives sans représentation disponible : échues ?'
select bool_and(s."expiresAt" is not null and s."expiresAt" <= now()) toutes_echues, count(distinct j.id) from "Job" j join "JobSource" s on s."jobId"=j.id and s."isActive"
where j."isActive" and not exists (select 1 from "JobSource" a where a."jobId"=j.id and a."isActive" and (a."expiresAt" is null or a."expiresAt" > now())) group by j.id having true limit 0;
select count(*) from (select j.id, bool_and(s."expiresAt" is not null and s."expiresAt" <= now()) e from "Job" j join "JobSource" s on s."jobId"=j.id and s."isActive"
where j."isActive" and not exists (select 1 from "JobSource" a where a."jobId"=j.id and a."isActive" and (a."expiresAt" is null or a."expiresAt" > now())) group by j.id) t group by e;

-- D-522 §6 : par source des familles nouvellement probantes, les offres actives absentes de leur collecte du 02/10 (RUN parti à 16:02 UTC)
-- et sans autre représentation active revue depuis : ce que le premier refresh qui les laisse attester fermerait. Lecture seule.
with fam as (select key, kind from "Source" where status='ACTIVE' and kind in ('lvmh_algolia','smartrecruiters-whitelabel','wttj','wttj-sector')),
absent as (select js."sourceKey", js."jobId" from "JobSource" js join fam on fam.key=js."sourceKey"
  where js."isActive" and js."lastSeenAt" < timestamp '2026-10-02 15:00' and js."jobId" is not null),
closable as (select a."sourceKey", a."jobId" from absent a join "Job" j on j.id=a."jobId" and j."isActive" and j."mergedIntoId" is null
  where not exists (select 1 from "JobSource" o where o."jobId"=a."jobId" and o."isActive" and o."lastSeenAt" >= timestamp '2026-10-02 15:00'))
select "sourceKey", count(distinct "jobId") offres_fermables from closable group by 1 order by 2 desc

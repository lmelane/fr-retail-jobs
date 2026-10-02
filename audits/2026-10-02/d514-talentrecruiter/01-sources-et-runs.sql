-- D-514 §4 : la source TalentRecruiter (une seule : ganni-talentrecruiter) et ses RUN des 7 derniers jours (lecture seule).
\pset pager off
SELECT key, kind, status, config->>'customer' customer FROM "Source" WHERE kind='talentrecruiter' ORDER BY 1;
SELECT r."sourceKey", to_char(r."ranAt",'MM-DD HH24:MI') ran, r.status, r.jobs, r."previousJobs" prev, r.fetched, r.accepted,
  r."declaredTotal" decl, r.complete cpl, r."canAttestAbsence" att, r.errors err, left(coalesce(r.note,''),300) note
FROM "SourceRun" r JOIN "Source" s ON s.key=r."sourceKey"
WHERE s.kind='talentrecruiter' AND r."ranAt" >= now() - interval '7 days'
ORDER BY 1, r."ranAt";

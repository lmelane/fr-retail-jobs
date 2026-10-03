-- D-522 §6 — sources ACTIVE qui ne servent aucune offre (lecture seule).
SELECT s.key, s.maison, s."lastRunStatus", s."lastRunJobs"
  FROM "Source" s
 WHERE s.status = 'ACTIVE'
   AND NOT EXISTS (SELECT 1 FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
                    WHERE js."sourceKey" = s.key AND js."isActive" AND j."isActive" AND j."withdrawnAt" IS NULL);

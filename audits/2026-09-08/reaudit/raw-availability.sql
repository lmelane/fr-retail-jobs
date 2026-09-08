BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object('dataset','raw-availability','rows',jsonb_build_array(jsonb_build_object(
'active_job_sources',(SELECT count(*) FROM "JobSource" WHERE "isActive"),
'active_source_raw_missing',(SELECT count(*) FROM "JobSource" WHERE "isActive" AND (raw IS NULL OR raw='null'::jsonb)),
'active_jobs_no_raw_anywhere',(SELECT count(*) FROM "Job" j WHERE j."isActive" AND (j.raw IS NULL OR j.raw='null'::jsonb) AND NOT EXISTS(SELECT 1 FROM "JobSource" s WHERE s."jobId"=j.id AND s.raw IS NOT NULL AND s.raw<>'null'::jsonb))
)));
COMMIT;

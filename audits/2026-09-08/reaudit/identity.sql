BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object('dataset','smcp-raw-shape','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT j.id,j.title,js."externalId",js.raw-'jobAd'-'description' raw FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" WHERE js."sourceKey"='sandro' AND j."isActive" ORDER BY j.id LIMIT 6)t;
SELECT jsonb_build_object('dataset','tiffany-source-geography','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT "jobId","sourceKey","externalId",title,url,raw-'description'-'jobDescription'-'jobDescriptionHtml' raw FROM "JobSource" WHERE "jobId" IN ('cmtrslaab1615pg5m8dosnymn','cmtrsla9p1610pg5mo0wtb1id'))t;
COMMIT;

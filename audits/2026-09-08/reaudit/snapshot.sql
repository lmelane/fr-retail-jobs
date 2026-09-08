BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object('dataset','snapshot','rows',jsonb_build_array(jsonb_build_object('at',now(),'readOnly',current_setting('transaction_read_only'),'isolation',current_setting('transaction_isolation'),'database',current_database(),'migrations',(select count(*) from "_prisma_migrations" where finished_at is not null))));
SELECT jsonb_build_object('dataset','totals','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT count(*) total,count(*) FILTER(WHERE "isActive") active,count(*) FILTER(WHERE NOT "isActive") closed,
count(*) FILTER(WHERE "isActive" AND "countryCode" IS NOT NULL) country_present,
count(*) FILTER(WHERE "isActive" AND "countryCode"='FR') country_fr,
count(*) FILTER(WHERE "isActive" AND "isFrance") flag_fr,
count(*) FILTER(WHERE "isActive" AND "isFrance" IS DISTINCT FROM COALESCE("countryCode"='FR', false)) france_flag_disagreement,
count(*) FILTER(WHERE "isActive" AND "jobFunction" IS NOT NULL) function_present,
count(*) FILTER(WHERE "isActive" AND "seniority" IS NOT NULL) seniority_present,
count(*) FILTER(WHERE "isActive" AND "employmentTerm" IS NOT NULL) term_present,
count(*) FILTER(WHERE "isActive" AND "workTime" IS NOT NULL) worktime_present,
count(*) FILTER(WHERE "isActive" AND "programType" IS NOT NULL) program_present,
count(*) FILTER(WHERE "isActive" AND "workplaceType" IS NOT NULL) workplace_present,
count(*) FILTER(WHERE "isActive" AND city IS NOT NULL) city_present,
count(*) FILTER(WHERE "isActive" AND "adminArea1" IS NOT NULL) region_present,
count(*) FILTER(WHERE "isActive" AND "postedAt">now()+interval '24 hours') future_posted,
count(*) FILTER(WHERE "isActive" AND "validThrough"<now()) expired_active,
count(*) FILTER(WHERE "isActive" AND "lastSeenAt"<now()-interval '48 hours') stale_job48h,
count(*) FILTER(WHERE "isActive" AND "lastSeenAt"<now()-interval '7 days') stale_job7d,
count(*) FILTER(WHERE "isActive" AND "closedAt" IS NOT NULL) active_closedat,
count(*) FILTER(WHERE NOT "isActive" AND "closedAt" IS NULL) inactive_no_closedat,
count(*) FILTER(WHERE "reopenedCount">0) reopened_jobs,
count(*) FILTER(WHERE "isActive" AND NOT EXISTS(SELECT 1 FROM "JobSource" s WHERE s."jobId"="Job".id AND s."isActive")) active_no_source,
count(*) FILTER(WHERE "isActive" AND NOT EXISTS(SELECT 1 FROM "JobSource" s WHERE s."jobId"="Job".id AND s."isActive" AND s."lastSeenAt">=now()-interval '48 hours')) active_no_fresh_source,
count(*) FILTER(WHERE "isActive" AND NOT EXISTS(SELECT 1 FROM "Company" c WHERE c.id="Job"."companyId")) orphan_company,
count(*) FILTER(WHERE "isActive" AND "countryIntegrity" IS NOT NULL) country_integrity_flagged,
count(*) FILTER(WHERE "isActive" AND description IS NOT NULL AND length(description)>100) description_present,
count(*) FILTER(WHERE "isActive" AND "postedAt" IS NOT NULL) posted_present
FROM "Job")t;
SELECT jsonb_build_object('dataset','countries','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT "countryCode",count(*) n,count(*) FILTER(WHERE "isFrance") flag_fr,count(*) FILTER(WHERE "jobFunction" IS NOT NULL) function_present,count(*) FILTER(WHERE "lastSeenAt"<now()-interval '48 hours') stale48h
FROM "Job" WHERE "isActive" GROUP BY 1 ORDER BY n DESC)t;
SELECT jsonb_build_object('dataset','companies','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT c.id,c.name,c."canonicalKey",c.kind,c.sector,c."parentGroup",c.domain,c."domainSource",c."careersUrl",c."atsType",c."discoveryStatus",c."lastJobSyncAt",
count(j.id) jobs,count(j.id) FILTER(WHERE j."isActive") active,count(j.id) FILTER(WHERE j."isActive" AND j."countryCode"='FR') fr,
(SELECT jsonb_agg(jsonb_build_object('key',a."aliasKey",'name',a."displayName")) FROM "CompanyAlias" a WHERE a."companyId"=c.id) aliases
FROM "Company" c LEFT JOIN "Job" j ON j."companyId"=c.id GROUP BY c.id ORDER BY active DESC,c.name)t;
SELECT jsonb_build_object('dataset','sources','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT s.key,s.maison,s.kind,s."careersDomain",s.status,s.tier,s."tenantKey",s."robotsVerdict",s."robotsCheckedAt",s."verifiedJobCount",s."lastRunAt",s."lastRunStatus",s."lastRunJobs",s."descriptionRate",s."countryRate",s.note,
(SELECT jsonb_object_agg(k,v) FROM jsonb_each(s.config) e(k,v) WHERE k IN ('url','origin','listingUrl','sitemapUrl','feedUrl','startUrl','host','tenant','site','board','boardToken','company','slug','domain','domainName','account','subdomain')) config,
(SELECT count(*) FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" WHERE js."sourceKey"=s.key AND js."isActive" AND j."isActive") active_jobs,
(SELECT count(*) FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" WHERE js."sourceKey"=s.key AND js."isActive" AND j."isActive" AND j."countryCode"='FR') fr_jobs
FROM "Source" s ORDER BY s.status,s.maison)t;
SELECT jsonb_build_object('dataset','company-source-links','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT j."companyId",js."sourceKey",s.status,count(*) total,count(*) FILTER(WHERE j."isActive" AND js."isActive") active
FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" LEFT JOIN "Source" s ON s.key=js."sourceKey" GROUP BY 1,2,3)t;
SELECT jsonb_build_object('dataset','latest-runs','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT DISTINCT ON("sourceKey") * FROM "SourceRun" ORDER BY "sourceKey","ranAt" DESC,id DESC)t;
SELECT jsonb_build_object('dataset','runs-history','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT * FROM "SourceRun" WHERE "ranAt">now()-interval '8 days' ORDER BY "ranAt" DESC)t;
SELECT jsonb_build_object('dataset','events','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT type,field,count(*) n,min(at) earliest,max(at) latest FROM "JobEvent" GROUP BY 1,2)t;
SELECT jsonb_build_object('dataset','trust','rows',jsonb_agg(to_jsonb(t))) FROM (SELECT * FROM "SourceFieldTrust")t;
SELECT jsonb_build_object('dataset','job-metadata','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT j.id,j."companyId",j."externalId",j.source,j.title,j.location,j."countryCode",j."isFrance",j.city,j."adminArea1",j."postalCode",j."inseeCode",j."employmentTerm",j."workTime",j."programType",j."engagementType",j."isSeasonal",j."workplaceType",j."jobFunction",j.seniority,j.department,j.url,j."postedAt",j."firstSeenAt",j."lastSeenAt",j."updatedAt",j."validThrough",j."closedAt",j."reopenedCount",j."isActive",j.fingerprint,j."clusterKey",j."canonicalSourceKey",j."canonicalExternalId",j."canonicalTier",j."taxonomyVersion",j."pipelineVersion",md5(coalesce(j.description,'')) description_hash,length(j.description) description_length,
jsonb_build_object('country',j.raw->'country','location',j.raw->'location','jobLocation',j.raw->'jobLocation','locations',j.raw->'locations','countryCode',j.raw->'countryCode','datePosted',j.raw->'datePosted','postedDate',j.raw->'postedDate') raw_geo_date,
(SELECT count(*) FROM "JobSource" js WHERE js."jobId"=j.id AND js."isActive") source_count,
(SELECT count(*) FROM "SourceObservation" o WHERE o."sourceKey"=j."canonicalSourceKey" AND o."externalId"=j."canonicalExternalId") observation_count
FROM "Job" j ORDER BY j.id)t;
COMMIT;

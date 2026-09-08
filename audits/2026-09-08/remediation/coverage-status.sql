BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object('dataset','current-coverage','at',now(),'readonly',current_setting('transaction_read_only'),
'companies',(SELECT count(*) FROM "Company"),
'canonical_keys',(SELECT count(DISTINCT "canonicalKey") FROM "Company"),
'companies_with_active_jobs',(SELECT count(*) FROM "Company" c WHERE EXISTS(SELECT 1 FROM "Job" j WHERE j."companyId"=c.id AND j."isActive")),
'canonical_keys_with_active_jobs',(SELECT count(DISTINCT c."canonicalKey") FROM "Company" c JOIN "Job" j ON j."companyId"=c.id WHERE j."isActive"),
'companies_without_active_source_footprint',(SELECT count(*) FROM "Company" c WHERE NOT EXISTS(SELECT 1 FROM "Job" j JOIN "JobSource" js ON js."jobId"=j.id JOIN "Source" s ON s.key=js."sourceKey" WHERE j."companyId"=c.id AND s.status='ACTIVE')),
'active_jobs',(SELECT count(*) FROM "Job" WHERE "isActive"),
'company_kinds',(SELECT jsonb_object_agg(kind,n) FROM (SELECT kind,count(*) n FROM "Company" GROUP BY kind)t),
'source_statuses',(SELECT jsonb_object_agg(status,n) FROM (SELECT status,count(*) n FROM "Source" GROUP BY status)t),
'active_adapter_families',(SELECT count(DISTINCT kind) FROM "Source" WHERE status='ACTIVE'),
'active_sources_with_verified_positive_count',(SELECT count(*) FROM "Source" WHERE status='ACTIVE' AND "verifiedJobCount">0),
'active_sources_with_jobs',(SELECT count(*) FROM "Source" s WHERE status='ACTIVE' AND EXISTS(SELECT 1 FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" WHERE js."sourceKey"=s.key AND js."isActive" AND j."isActive")),
'correction_table_exists',to_regclass('public."DataCorrection"') IS NOT NULL);
SELECT jsonb_build_object('dataset','smcp-brand-counts','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT COALESCE((SELECT f->>'valueLabel' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(js.raw->'customField')='array' THEN js.raw->'customField' ELSE '[]'::jsonb END) f WHERE f->>'fieldLabel'='Brands' LIMIT 1),'INCONNU') AS raw_brand,c.name AS stored_company,count(*) n
FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" JOIN "Company" c ON c.id=j."companyId" WHERE js."sourceKey"='sandro' AND js."isActive" AND j."isActive" GROUP BY 1,2)t;
SELECT jsonb_build_object('dataset','company-identities','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT c.id,c.name,c."canonicalKey",c.domain,c."parentGroup",(SELECT jsonb_agg(jsonb_build_object('key',a."aliasKey",'display',a."displayName")) FROM "CompanyAlias" a WHERE a."companyId"=c.id) aliases,(SELECT count(*) FROM "Job" j WHERE j."companyId"=c.id AND j."isActive") active FROM "Company" c)t;
COMMIT;

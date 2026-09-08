BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object('dataset','smcp-brand-counts','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT COALESCE((SELECT f->>'valueLabel' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(js.raw->'customField')='array' THEN js.raw->'customField' ELSE '[]'::jsonb END) f WHERE f->>'fieldLabel'='Brands' LIMIT 1),'INCONNU') AS raw_brand,c.name AS stored_company,count(*) n,count(*) FILTER(WHERE j."countryCode"='FR') france
FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" JOIN "Company" c ON c.id=j."companyId" WHERE js."sourceKey"='sandro' AND js."isActive" AND j."isActive" GROUP BY 1,2)t;
SELECT jsonb_build_object('dataset','smcp-brand-rows','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT j.id,j.title,j."countryCode",c.name stored_company,js."externalId",js.url,(SELECT f->>'valueLabel' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(js.raw->'customField')='array' THEN js.raw->'customField' ELSE '[]'::jsonb END) f WHERE f->>'fieldLabel'='Brands' LIMIT 1) raw_brand
FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" JOIN "Company" c ON c.id=j."companyId" WHERE js."sourceKey"='sandro' AND js."isActive" AND j."isActive")t;
COMMIT;

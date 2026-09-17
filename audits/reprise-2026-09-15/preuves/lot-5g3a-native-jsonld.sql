WITH native AS (
 SELECT s.kind, js.id, js."sourceKey", js."externalId", js.raw->'hiringOrganization' AS organization
 FROM "JobSource" js JOIN "Source" s ON s.key=js."sourceKey"
 WHERE js.raw->>'@type'='JobPosting'
), counts AS (
 SELECT kind, jsonb_typeof(organization) AS "organizationType",
 count(*) AS "publications", count(*) FILTER (WHERE jsonb_typeof(organization->'name')='string' AND btrim(organization->>'name')<>'') AS "nonblankStringNames"
 FROM native GROUP BY kind,jsonb_typeof(organization)
), samples AS (
 SELECT kind,id,"sourceKey","externalId",organization->>'name' AS "nativeEmployer" FROM native
 WHERE kind='generic-listing' AND jsonb_typeof(organization->'name')='string' AND btrim(organization->>'name')<>'' ORDER BY "sourceKey",id LIMIT 8
) SELECT jsonb_build_object('readOnly', current_setting('transaction_read_only'), 'database',current_database(), 'at',now(),
 'counts',(SELECT jsonb_agg(to_jsonb(counts) ORDER BY kind,"organizationType") FROM counts), 'samples',(SELECT jsonb_agg(to_jsonb(samples)) FROM samples));

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object('dataset','raw-quality','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT source,count(*) n,count(*) FILTER(WHERE raw IS NULL OR raw='null'::jsonb) raw_missing,
count(*) FILTER(WHERE jsonb_typeof(raw)='object' AND (SELECT count(*) FROM jsonb_object_keys(raw))<=3) raw_three_or_fewer_keys,
count(*) FILTER(WHERE NOT EXISTS (SELECT 1 FROM "JobEvent" e WHERE e."jobId"=j.id)) no_events,
count(*) FILTER(WHERE NOT EXISTS (SELECT 1 FROM "JobEvent" e WHERE e."jobId"=j.id AND e.type='OPENED')) no_open_event
FROM "Job" j WHERE "isActive" GROUP BY source)t;
SELECT jsonb_build_object('dataset','current-column-types','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('Job','JobSource','SourceObservation','Company','Source') AND (column_name ilike '%confidence%' OR column_name ilike '%method%' OR column_name ilike '%provenance%' OR column_name IN ('kind','parentGroup','countryCode','updatedAt','lastSeenAt','raw','sourceKey')))t;
SELECT jsonb_build_object('dataset','run-cadence','rows',jsonb_agg(to_jsonb(t))) FROM (
WITH deltas AS (SELECT "sourceKey",extract(epoch FROM("ranAt"-lag("ranAt") over(partition by "sourceKey" order by "ranAt")))/3600 hours FROM "SourceRun" WHERE "ranAt">now()-interval '7 days')
SELECT "sourceKey",count(*) FILTER(WHERE hours>0) intervals,percentile_cont(.5) within group(order by hours) median_hours,max(hours) max_hours FROM deltas GROUP BY 1)t;
SELECT jsonb_build_object('dataset','event-lifecycle-examples','rows',jsonb_agg(to_jsonb(t))) FROM (
SELECT j.id,j.title,j."firstSeenAt",j."lastSeenAt",j."closedAt",j."reopenedCount",jsonb_agg(jsonb_build_object('type',e.type,'field',e.field,'at',e.at) order by e.at) events FROM "Job" j JOIN "JobEvent" e ON e."jobId"=j.id WHERE j."reopenedCount">0 GROUP BY j.id ORDER BY j."reopenedCount" DESC LIMIT 8)t;
COMMIT;

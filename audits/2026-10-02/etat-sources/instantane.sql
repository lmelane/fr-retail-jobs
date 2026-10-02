-- D-520 : instantané en lecture seule des données nécessaires au calcul de l'état opérationnel des sources.
-- Rejouable : db.py readonly psql -At -f instantane.sql (hors fenêtre du RUN 15:30-18:30 UTC). Une ligne JSON par jeu.
-- Offres servies : sans la colonne de retenue (`availabilityHold`), absente de la production au 02/10 (r6 non livrée).
\pset footer off
\set QUIET on
SELECT json_build_object('jeu','meta','at',now(),'migrations',(SELECT json_agg(migration_name ORDER BY migration_name) FROM _prisma_migrations WHERE migration_name >= '20261001'));
SELECT json_build_object('jeu','sources','rows',(SELECT json_agg(json_build_object('key',key,'maison',maison,'kind',kind,'status',status,'tier',tier,
  'note',note,'lastRunAt',"lastRunAt",'lastRunStatus',"lastRunStatus",'lastRunJobs',"lastRunJobs",'createdAt',"createdAt",'updatedAt',"updatedAt") ORDER BY key) FROM "Source"));
SELECT json_build_object('jeu','pipelineRuns','rows',(SELECT json_agg(json_build_object('id',id,'command',command,'revision',revision,'status',status,
  'startedAt',"startedAt",'finishedAt',"finishedAt") ORDER BY "startedAt") FROM "PipelineRun" WHERE "startedAt" > now() - interval '10 days'));
SELECT json_build_object('jeu','sourceRuns','rows',(SELECT json_agg(json_build_object('runId',"runId",'sourceKey',"sourceKey",'status',status,'jobs',jobs,
  'previousJobs',"previousJobs",'fetched',fetched,'accepted',accepted,'declaredTotal',"declaredTotal",'truncated',truncated,'errors',errors,
  'complete',complete,'canAttestAbsence',"canAttestAbsence",'note',left(note,400),'ranAt',"ranAt") ORDER BY "ranAt") FROM "SourceRun" WHERE "ranAt" > now() - interval '10 days'));
SELECT json_build_object('jeu','events','rows',(SELECT json_agg(json_build_object('runId',"runId",'at',at,'level',level,'event',event,'sourceKey',"sourceKey",
  'payload',CASE WHEN event IN ('source.issue_classified') THEN payload
    WHEN event='source_sync_completed' THEN jsonb_build_object('fetched',payload->'fetched','created',payload->'created','held',payload->'held','errors',payload->'errors','health',payload->'health')
    ELSE jsonb_build_object('message',left(coalesce(payload->>'message',payload->>'msg',payload::text),400)) END) ORDER BY at)
  FROM "PipelineEvent" WHERE at > now() - interval '10 days'
    AND event IN ('source.issue_classified','source.timed_out','source.challenged','source.failed','source.record_failed','source_sync_completed','run.sources_completed','command.failed','run.finalization_failed','coverage.failed','coverage.reviewed')));
SELECT json_build_object('jeu','runSelections','rows',(SELECT json_agg(json_build_object('runId',"runId",'at',at,'sourceKeys',payload->'sourceKeys')) FROM "PipelineEvent"
  WHERE at > now() - interval '10 days' AND event='run.sources_selected'));
SELECT json_build_object('jeu','servedBySource','rows',(SELECT json_agg(json_build_object('sourceKey',s,'served',n)) FROM (
  SELECT js."sourceKey" s, count(DISTINCT j.id)::int n FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId"
  WHERE js."isActive" AND (js."expiresAt" IS NULL OR js."expiresAt" > now()) AND j."isActive" AND j."mergedIntoId" IS NULL GROUP BY 1) x));
SELECT json_build_object('jeu','eventNames','rows',(SELECT json_agg(json_build_object('event',event,'n',n)) FROM (SELECT event, count(*)::int n FROM "PipelineEvent" WHERE at > now() - interval '3 days' GROUP BY 1 ORDER BY 2 DESC) x));

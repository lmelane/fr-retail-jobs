-- D-514 §4 : tout événement de la source TalentRecruiter dans les RUN des 7 derniers jours, hors info (lecture seule).
\pset pager off
SELECT e."runId", to_char(e.at,'MM-DD HH24:MI:SS') t, e.level, e.event, left(e.payload::text, 1200) payload
FROM "PipelineEvent" e JOIN "Source" s ON s.key=e."sourceKey"
WHERE s.kind='talentrecruiter' AND e.at >= now() - interval '7 days' AND (e.level <> 'info' OR e.event LIKE 'source.%')
ORDER BY e.at;

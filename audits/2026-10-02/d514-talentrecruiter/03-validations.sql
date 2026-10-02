-- D-514 §4 : validations natives de ganni-talentrecruiter sur 7 jours, verdict et motifs (lecture seule).
\pset pager off
SELECT to_char(b."startedAt",'MM-DD HH24:MI:SS') debut, b.purpose, left(b."readerRevision",10) reader, v.verdict,
  v.report->'issues' issues, v.report->>'reason' reason, left(v.report::text, 900) report
FROM "CaptureBatch" b LEFT JOIN "SourceValidation" v ON v."captureBatchId"=b.id
WHERE b."sourceKey"='ganni-talentrecruiter' AND b."startedAt" >= now() - interval '7 days'
ORDER BY b."startedAt";

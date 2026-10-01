-- Validations natives et captures de ganni-talentrecruiter et versace, 01/10/2026 (lecture seule).
\pset pager off
SELECT b."sourceKey", b.id batch, to_char(b."startedAt",'MM-DD HH24:MI:SS') debut, b.purpose, left(b."readerRevision",14) reader,
  v.verdict, left(v.report::text, 1800) report
FROM "CaptureBatch" b LEFT JOIN "SourceValidation" v ON v."captureBatchId"=b.id
WHERE b."sourceKey" IN ('ganni-talentrecruiter','versace') AND b."startedAt" >= now() - interval '2 days 3 hours'
ORDER BY 1, b."startedAt";

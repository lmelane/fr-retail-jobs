-- D-520 : toutes les validations dont le rejeu hors réseau a rendu un résultat différent (REPLAY_RESULT_CHANGED), par
-- source et famille, du 22/09 au 02/10, avec le lot et la révision du lecteur. LECTURE SEULE, hors fenêtre du RUN.
\pset footer off
\pset format csv
SET statement_timeout = '120s';
SET default_transaction_read_only = on;
SELECT b."sourceKey", b."sourceKind", v."validatedAt", v.verdict, b.id batch, b."readerRevision"
FROM "SourceValidation" v JOIN "CaptureBatch" b ON b.id = v."captureBatchId"
WHERE v."validatedAt" >= '2026-09-22' AND v.report->'reasons' ? 'REPLAY_RESULT_CHANGED'
ORDER BY v."validatedAt";

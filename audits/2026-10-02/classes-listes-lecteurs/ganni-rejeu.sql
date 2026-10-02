-- D-520 : la qualification rejetée de ganni-talentrecruiter du 01/10 (REPLAY_RESULT_CHANGED) — rapport complet et
-- événements du journal de la même capture. LECTURE SEULE, hors fenêtre du RUN.
\pset footer off
\pset format csv
SET statement_timeout = '60s';
SET default_transaction_read_only = on;
SELECT v."validatedAt", v.verdict, b.id batch, b."readerRevision", v.report::text report
FROM "SourceValidation" v JOIN "CaptureBatch" b ON b.id = v."captureBatchId"
WHERE b."sourceKey" = 'ganni-talentrecruiter' AND v."validatedAt" BETWEEN '2026-09-30 12:00' AND '2026-10-02 12:00' ORDER BY 1;
SELECT e.at, e.event, left(e.payload::text, 1200) payload FROM "PipelineEvent" e
WHERE e."sourceKey" = 'ganni-talentrecruiter' AND e.at BETWEEN '2026-10-01 15:50' AND '2026-10-01 16:30' ORDER BY e.at;

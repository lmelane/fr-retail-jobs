-- D-520 : par famille d'adaptateur (Source.kind), les sources actives et l'état de preuve de leur dernière collecte
-- (complete, canAttestAbsence, truncated, declaredTotal présent), plus la note. LECTURE SEULE, hors fenêtre du RUN.
\pset footer off
\pset format csv
SET statement_timeout = '120s';
SET default_transaction_read_only = on;
SELECT s.key, s.kind, s.status, s.config->>'listingUrl' listing, sr."ranAt", sr.status sr_status, sr.jobs, sr."declaredTotal",
       sr.truncated, sr.complete, sr."canAttestAbsence", left(sr.note, 200) note
FROM "Source" s
LEFT JOIN LATERAL (SELECT * FROM "SourceRun" x WHERE x."sourceKey" = s.key ORDER BY x."ranAt" DESC LIMIT 1) sr ON true
WHERE true
ORDER BY s.kind, s.key;

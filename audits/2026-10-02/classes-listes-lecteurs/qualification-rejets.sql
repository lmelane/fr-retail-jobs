-- D-520 : la cause de chaque qualification rejetée (SourceValidation.verdict = REJECTED) des sources de la classe
-- « qualification rejetée », du 22/09 au 02/10, et le dernier verdict par source. LECTURE SEULE, hors fenêtre du RUN.
\pset footer off
\pset format csv
SET statement_timeout = '120s';
SET default_transaction_read_only = on;
SELECT b."sourceKey", b."sourceKind", b.purpose, b."readerRevision", v.verdict, v."policyVersion", v."validatedAt",
       left(v.report::text, 1500) report
FROM "SourceValidation" v JOIN "CaptureBatch" b ON b.id = v."captureBatchId"
WHERE b."sourceKey" IN ('estee-lauder-companies','kering','pvh','zegna-altamira','sephora-france','groupe-chantelle','ganni-talentrecruiter')
  AND v."validatedAt" >= '2026-09-22'
ORDER BY b."sourceKey", v."validatedAt";

-- D-520 : l'effet en production de la fausse preuve de liste complète de knitwell-us-retail (plafond Workday de 2 000
-- lu comme une fin de liste). LECTURE SEULE, hors fenêtre du RUN (avant 15:30 ou après 18:30 UTC). Rejouable :
--   CATWALKS_DB_ACCESS=<checkout>/backups/remediation-20260908 python3 apps/aggregator/scripts/ops/db.py readonly sh -c \
--     'psql "$DATABASE_URL" -XA -v ON_ERROR_STOP=1 -f audits/2026-10-02/classes-listes-lecteurs/knitwell-effet.sql' \
--     > audits/2026-10-02/classes-listes-lecteurs/knitwell-effet.out
-- 1. les collectes de la source et leur droit d'attester ; 2. l'état des représentations (actives, retenues de
-- disponibilité, fermées) ; 3. les retenues et fermetures datées depuis le 27/09.
\pset footer off
SET statement_timeout = '120s';
SET default_transaction_read_only = on;
SELECT "ranAt", status, jobs, fetched, "declaredTotal", truncated, complete, "canAttestAbsence", left(note, 140) note
FROM "SourceRun" WHERE "sourceKey" = 'knitwell-us-retail' AND "ranAt" >= '2026-09-24' ORDER BY "ranAt";
SELECT "isActive", coalesce("availabilityHold", '-') hold, ("quarantinedAt" IS NOT NULL) quarantined, count(*)
FROM "JobSource" WHERE "sourceKey" = 'knitwell-us-retail' GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
SELECT date_trunc('hour', "availabilityHoldAt") held_at, "availabilityHold", "isActive", count(*)
FROM "JobSource" WHERE "sourceKey" = 'knitwell-us-retail' AND "availabilityHoldAt" >= '2026-09-27'
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
SELECT date_trunc('day', "lastSeenAt") last_seen, "isActive", count(*)
FROM "JobSource" WHERE "sourceKey" = 'knitwell-us-retail' AND "lastSeenAt" >= '2026-09-20' GROUP BY 1, 2 ORDER BY 1, 2;

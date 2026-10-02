-- D-493 — LECTURE SEULE, préparée à blanc, JAMAIS exécutée par ce lot.
-- La révision exacte que `source-add --registered-revision` requalifiera, et ce qu'elle contient.
--
--   python3 apps/aggregator/scripts/ops/db.py readonly psql -f audits/2026-10-02/d493-swatch/reouverture-revision.sql
--
-- Attendu : une ligne, status = PAUSED, kind = swatchgroup, config limitée à origin / lang (et peut-être
-- reconcileLangs, désormais sans effet : le lecteur D-493 ne relit plus aucune autre langue). Toute autre clé de
-- configuration se relit avant la commande de réouverture.
SELECT s.key,
       s.status,
       s.kind,
       s."careersDomain",
       s.config,
       s."currentRevisionId" AS revision,
       r.version,
       r."observedAt",
       r."payloadHash"
FROM "Source" s
JOIN "SourceRevision" r ON r.id = s."currentRevisionId"
WHERE s.key = 'swatch-group';

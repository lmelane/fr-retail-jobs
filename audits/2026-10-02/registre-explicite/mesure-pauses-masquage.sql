-- D-520 — effet à blanc du plafond de 72 h (R-143 §2) s'il s'appliquait aux pauses non décidées (lecture seule, 02/10/2026).
-- Par source en pause : représentations actives et celles non revues depuis 72 h (la colonne de retenue de R-143 §2
-- n'existe pas encore en production : migration 20261002140000 non appliquée au 02/10).
SELECT json_agg(row_to_json(t) ORDER BY t.key) FROM (
  SELECT s.key, count(js.*) FILTER (WHERE js."isActive") AS active,
         count(js.*) FILTER (WHERE js."isActive" AND js."lastSeenAt" < now() - interval '72 hours') AS "staleOver72h",
         max(js."lastSeenAt") AS "lastSeen"
    FROM "Source" s LEFT JOIN "JobSource" js ON js."sourceKey" = s.key
   WHERE s.status = 'PAUSED' GROUP BY s.key
) t;

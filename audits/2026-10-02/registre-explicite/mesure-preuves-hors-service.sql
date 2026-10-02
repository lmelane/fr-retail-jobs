-- D-520 — pour chaque source qui n'est pas ACTIVE : la dernière validation, la dernière décision d'accès et la dernière
-- revue d'identité, toutes révisions confondues (lecture seule, 02/10/2026).
-- Rejouable : python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -At -f <ce fichier>' > preuves-hors-service-2026-10-02.json
SELECT json_agg(row_to_json(t) ORDER BY t.key) FROM (
  SELECT s.key, s.status::text AS status,
    (SELECT json_build_object('verdict', v.verdict, 'at', v."validatedAt", 'current', v."sourceRevisionId" = s."currentRevisionId",
                              'reasons', v.report -> 'reasons', 'policy', v."policyVersion")
       FROM "SourceValidation" v JOIN "SourceRevision" r ON r.id = v."sourceRevisionId"
      WHERE r."sourceId" = s.id ORDER BY v."validatedAt" DESC LIMIT 1) AS "lastValidation",
    (SELECT json_build_object('verdict', a.verdict, 'at', a."checkedAt", 'validUntil', a."validUntil")
       FROM "SourceAccessDecision" a WHERE a."sourceKey" = s.key ORDER BY a."checkedAt" DESC LIMIT 1) AS "lastAccess",
    (SELECT json_build_object('verdict', i.verdict, 'at', i."checkedAt", 'method', i.method, 'reviewer', i.reviewer,
                              'statement', left(i.statement, 400))
       FROM "SourceIdentityReview" i WHERE i."sourceKey" = s.key ORDER BY i."checkedAt" DESC LIMIT 1) AS "lastIdentity",
    (SELECT count(*) FROM "SourceRun" sr WHERE sr."sourceKey" = s.key) AS "runs",
    (SELECT max(sr."ranAt") FROM "SourceRun" sr WHERE sr."sourceKey" = s.key AND sr.status IN ('OK', 'DEGRADED')) AS "lastGoodRunAt"
  FROM "Source" s WHERE s.status <> 'ACTIVE'
) t;

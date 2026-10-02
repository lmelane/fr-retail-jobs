-- D-520 — registre explicite des sources : photographie en lecture seule du registre (02/10/2026).
-- Rejouable : python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -At -f audits/2026-10-02/registre-explicite/mesure-registre.sql' > audits/2026-10-02/registre-explicite/registre-2026-10-02.json
-- La configuration des adaptateurs n'est pas exportée (elle porte des clés de recherche publiques).
-- Une seule ligne JSON : toutes les sources (543 au 02/10), avec ce qui permet de lire leur état sans deviner.
--   activeJobs      : publications actives encore portées par la source (JobSource.isActive)
--   everJobs        : publications jamais portées (un RETIRED à 0 n'a jamais rien apporté)
--   topCompanies    : les sociétés (Maisons) servies par ses publications actives, pour compter les doublons de Maison
--   lastRuns        : les 3 derniers SourceRun (statut, offres, note), pour lire la panne réelle d'une pause
--   firstRevisionAt : date de la première révision (entrée au registre)
SELECT json_agg(row_to_json(s) ORDER BY s.key) FROM (
  SELECT src.key, src.maison, src.kind, src.tier, src.status::text AS status, src."tenantKey", src."careersDomain",
         src."portalScope", src.note, src."lastRunAt", src."lastRunStatus", src."lastRunJobs", src."createdAt", src."updatedAt",
         (SELECT min(r."observedAt") FROM "SourceRevision" r WHERE r."sourceId" = src.id) AS "firstRevisionAt",
         (SELECT count(*) FROM "JobSource" js WHERE js."sourceKey" = src.key AND js."isActive") AS "activeJobs",
         (SELECT count(*) FROM "JobSource" js WHERE js."sourceKey" = src.key) AS "everJobs",
         (SELECT json_agg(t) FROM (
            SELECT c.id, c.name, c."canonicalKey", count(*) AS n
              FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId" JOIN "Company" c ON c.id = j."companyId"
             WHERE js."sourceKey" = src.key AND js."isActive"
             GROUP BY c.id, c.name, c."canonicalKey" ORDER BY count(*) DESC LIMIT 5) t) AS "topCompanies",
         (SELECT json_agg(t) FROM (
            SELECT sr.status, sr.jobs, sr.note, sr."ranAt"
              FROM "SourceRun" sr WHERE sr."sourceKey" = src.key ORDER BY sr."ranAt" DESC LIMIT 3) t) AS "lastRuns"
    FROM "Source" src
) s;

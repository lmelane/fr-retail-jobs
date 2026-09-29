-- Lot 2B de D-475 (plan docs/architecture/classification-metiers.md §3.6, sous-lots 2B-4 et 2B-5) : ADDITIVE.
-- À appliquer avec les migrations 20260929160000 et 20260929160100, hors RUN.
--
-- 1. Changer de version de taxonomie (ou de secteurs) ne remet plus tout l'index en file d'un coup : 80 741 offres
--    d'une seule transaction, dont la file servie mettait plusieurs minutes à se vider, au-delà du seuil de 300 s qui
--    rend la recherche indisponible (`requireSearchIndex`). La révision s'incrémente toujours (le modèle de requête
--    se recharge) ; une demande de remise en file est posée pour chaque génération, et l'indexeur la sert par
--    TRANCHES (`advanceSearchRequeue`, apps/api/lib/search-index.ts).
-- 2. Le document de recherche lit désormais les métiers lus dans l'intitulé (`titleRoles`, D-475 point 38) : leur
--    changement remet l'offre en file, comme celui de son code.
SET lock_timeout = '5s';

CREATE TABLE "SearchRequeue" (
  "version" TEXT NOT NULL,
  "phase" TEXT NOT NULL DEFAULT 'job',
  "cursor" TEXT,
  "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "doneAt" TIMESTAMPTZ,
  CONSTRAINT "SearchRequeue_pkey" PRIMARY KEY ("version"),
  CONSTRAINT search_requeue_phase CHECK ("phase" IN ('job','direct','done')),
  CONSTRAINT search_requeue_done CHECK (("phase" = 'done') = ("doneAt" IS NOT NULL))
);
ALTER TABLE "SearchRequeue" ADD CONSTRAINT "SearchRequeue_version_fkey" FOREIGN KEY ("version") REFERENCES "SearchGeneration"("version") ON DELETE CASCADE;

-- Mêmes branches qu'en 20260924120000_search_projection, sauf la taxonomie et les secteurs : une demande par
-- génération (reprise du début si une demande court encore), au lieu de tout le stock dans la file.
CREATE OR REPLACE FUNCTION catwalks_search_metadata_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "SearchMetadata" SET revision=revision+1 WHERE id='active';
 IF TG_TABLE_NAME IN ('OccupationState','SectorConcept') THEN
   INSERT INTO "SearchRequeue"(version) SELECT version FROM "SearchGeneration"
     ON CONFLICT(version) DO UPDATE SET phase='job', cursor=NULL, "requestedAt"=now(), "doneAt"=NULL;
 ELSIF TG_TABLE_NAME='Company' THEN
   INSERT INTO "SearchPending"(version,id) SELECT g.version,j.id FROM "SearchGeneration" g CROSS JOIN "Job" j WHERE j."companyId"=COALESCE(NEW.id,OLD.id) OR j."companyId" IN (SELECT id FROM "Company" WHERE "parentGroupId"=COALESCE(NEW.id,OLD.id) OR ("parentGroupId" IS NULL AND "parentGroup" IS NOT NULL))
     UNION ALL SELECT g.version,'cw_'||d.id FROM "SearchGeneration" g CROSS JOIN "DirectOffer" d ON CONFLICT(version,id) DO UPDATE SET id=EXCLUDED.id;
 ELSIF TG_TABLE_NAME='CompanyAlias' THEN
   INSERT INTO "SearchPending"(version,id) SELECT g.version,j.id FROM "SearchGeneration" g CROSS JOIN "Job" j
     JOIN "Company" c ON c.id=j."companyId" WHERE c."parentGroupId" IS NULL AND c."parentGroup" IS NOT NULL
     UNION ALL SELECT g.version,'cw_'||d.id FROM "SearchGeneration" g CROSS JOIN "DirectOffer" d ON CONFLICT(version,id) DO UPDATE SET id=EXCLUDED.id;
 END IF;
 RETURN NULL;
END; $$;

CREATE TRIGGER catwalks_search_job_title_roles AFTER UPDATE OF "titleRoles" ON "Job"
 FOR EACH ROW WHEN (NEW."titleRoles" IS DISTINCT FROM OLD."titleRoles") EXECUTE FUNCTION catwalks_search_posting_changed();
CREATE TRIGGER catwalks_search_direct_title_roles AFTER UPDATE OF "titleRoles" ON "DirectOffer"
 FOR EACH ROW WHEN (NEW."titleRoles" IS DISTINCT FROM OLD."titleRoles") EXECUTE FUNCTION catwalks_search_posting_changed();

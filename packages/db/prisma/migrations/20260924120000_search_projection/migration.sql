-- Rebuildable, versioned search projection. Publication is always checked live.
BEGIN;
SET LOCAL lock_timeout = '2s';
CREATE TABLE "SearchGeneration" (version text PRIMARY KEY, "createdAt" timestamptz NOT NULL DEFAULT now(), "readyAt" timestamptz);
CREATE TABLE "SearchMetadata" (id text PRIMARY KEY CHECK (id='active'), revision bigint NOT NULL DEFAULT 0);
INSERT INTO "SearchMetadata" (id) VALUES ('active');
CREATE FUNCTION catwalks_search_vector(doc jsonb) RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT setweight(to_tsvector('simple',coalesce(doc->>'title','')),'A')
 || setweight(to_tsvector('simple',coalesce(doc->>'company','')),'B')
 || setweight(to_tsvector('simple',coalesce(doc->>'duties','')),'C')
 || setweight(to_tsvector('simple',coalesce(doc->>'body','')),'D')
 || to_tsvector('simple',CASE WHEN jsonb_array_length(coalesce(doc->'titleRoles','[]'::jsonb))>0 THEN 'cwhastitlerole' ELSE '' END)
 || to_tsvector('simple',coalesce((SELECT string_agg('cwi'||md5(kind||':'||value),' ')
 FROM (SELECT 'role' AS kind,jsonb_array_elements_text(doc->'roles') AS value
 UNION ALL SELECT 'family',jsonb_array_elements_text(doc->'families')
 UNION ALL SELECT 'sector',jsonb_array_elements_text(doc->'sectors')
 UNION ALL SELECT 'company',jsonb_array_elements_text(doc->'companyKeys')) i),''));
$$;
CREATE TABLE "SearchDocument" (
 version text NOT NULL REFERENCES "SearchGeneration"(version) ON DELETE CASCADE,
 id text NOT NULL, document jsonb NOT NULL,
 vector tsvector GENERATED ALWAYS AS (catwalks_search_vector(document)) STORED,
 "indexedAt" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(version,id)
);
CREATE INDEX "SearchDocument_vector_idx" ON "SearchDocument" USING gin(vector);
CREATE TABLE "SearchPending" (
 version text NOT NULL REFERENCES "SearchGeneration"(version) ON DELETE CASCADE,
 id text NOT NULL, "queuedAt" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(version,id)
);
CREATE INDEX "SearchPending_version_queuedAt_idx" ON "SearchPending"(version,"queuedAt");
CREATE FUNCTION catwalks_search_enqueue(posting text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO "SearchPending"(version,id) SELECT version,posting FROM "SearchGeneration"
 ON CONFLICT(version,id) DO UPDATE SET id=EXCLUDED.id;
$$;
CREATE FUNCTION catwalks_search_posting_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM catwalks_search_enqueue(CASE WHEN TG_TABLE_NAME='DirectOffer' THEN 'cw_' ELSE '' END || CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END);
 RETURN NULL;
END; $$;
CREATE TRIGGER catwalks_search_job_insert_delete AFTER INSERT OR DELETE ON "Job" FOR EACH ROW EXECUTE FUNCTION catwalks_search_posting_changed();
CREATE TRIGGER catwalks_search_job_update AFTER UPDATE OF title,"rawTitle",description,department,city,location,"companyId","occupationCode","jobFunction","employmentTerm" ON "Job"
 FOR EACH ROW WHEN ((NEW.title,NEW."rawTitle",NEW.description,NEW.department,NEW.city,NEW.location,NEW."companyId",NEW."occupationCode",NEW."jobFunction",NEW."employmentTerm") IS DISTINCT FROM
 (OLD.title,OLD."rawTitle",OLD.description,OLD.department,OLD.city,OLD.location,OLD."companyId",OLD."occupationCode",OLD."jobFunction",OLD."employmentTerm")) EXECUTE FUNCTION catwalks_search_posting_changed();
CREATE TRIGGER catwalks_search_direct_insert_delete AFTER INSERT OR DELETE ON "DirectOffer" FOR EACH ROW EXECUTE FUNCTION catwalks_search_posting_changed();
CREATE TRIGGER catwalks_search_direct_update AFTER UPDATE OF title,description,company,city,location,"sectorCodes","employmentTerm" ON "DirectOffer"
 FOR EACH ROW WHEN ((NEW.title,NEW.description,NEW.company,NEW.city,NEW.location,NEW."sectorCodes",NEW."employmentTerm") IS DISTINCT FROM
 (OLD.title,OLD.description,OLD.company,OLD.city,OLD.location,OLD."sectorCodes",OLD."employmentTerm")) EXECUTE FUNCTION catwalks_search_posting_changed();
CREATE FUNCTION catwalks_search_metadata_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "SearchMetadata" SET revision=revision+1 WHERE id='active';
 IF TG_TABLE_NAME IN ('OccupationState','SectorConcept') THEN
   INSERT INTO "SearchPending"(version,id) SELECT g.version,j.id FROM "SearchGeneration" g CROSS JOIN "Job" j
     UNION ALL SELECT g.version,'cw_'||d.id FROM "SearchGeneration" g CROSS JOIN "DirectOffer" d ON CONFLICT(version,id) DO UPDATE SET id=EXCLUDED.id;
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
CREATE TRIGGER catwalks_search_company_insert_delete AFTER INSERT OR DELETE ON "Company" FOR EACH ROW EXECUTE FUNCTION catwalks_search_metadata_changed();
CREATE TRIGGER catwalks_search_company_update AFTER UPDATE OF name,"parentGroup","parentGroupId","mergedIntoId","sectorCodes" ON "Company"
 FOR EACH ROW WHEN ((NEW.name,NEW."parentGroup",NEW."parentGroupId",NEW."mergedIntoId",NEW."sectorCodes") IS DISTINCT FROM (OLD.name,OLD."parentGroup",OLD."parentGroupId",OLD."mergedIntoId",OLD."sectorCodes")) EXECUTE FUNCTION catwalks_search_metadata_changed();
CREATE TRIGGER catwalks_search_alias AFTER INSERT OR UPDATE OR DELETE ON "CompanyAlias" FOR EACH ROW EXECUTE FUNCTION catwalks_search_metadata_changed();
CREATE TRIGGER catwalks_search_occupation AFTER INSERT OR UPDATE OR DELETE ON "OccupationState" FOR EACH STATEMENT EXECUTE FUNCTION catwalks_search_metadata_changed();
CREATE TRIGGER catwalks_search_sector AFTER INSERT OR UPDATE OR DELETE ON "SectorConcept" FOR EACH STATEMENT EXECUTE FUNCTION catwalks_search_metadata_changed();
COMMIT;

CREATE INDEX "SectorReview_createdAt_id_idx" ON "SectorReview" ("createdAt",id);
ALTER TABLE "SectorConcept" ADD CONSTRAINT sector_concept_labels CHECK (code ~ '^[A-Z][A-Z0-9_]{0,79}$' AND length(trim(labels->>'fr'))>0 AND length(trim(labels->>'en'))>0 AND labels ? 'fr' AND labels ? 'en');
CREATE FUNCTION protect_sector_concept_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Sector concepts cannot be deleted; historical identities are retained'; END IF;
 IF NEW.code<>OLD.code OR NEW.slug<>OLD.slug OR NEW.definition<>OLD.definition THEN RAISE EXCEPTION 'Sector concept identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sector_concept_identity BEFORE UPDATE OR DELETE ON "SectorConcept" FOR EACH ROW EXECUTE FUNCTION protect_sector_concept_identity();
CREATE FUNCTION guard_merged_sector_memberships() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."mergedIntoId" IS NOT NULL AND NEW."mergedIntoId" IS DISTINCT FROM OLD."mergedIntoId" AND NOT EXISTS (SELECT 1 FROM "Company" target WHERE target.id=NEW."mergedIntoId" AND target."sectorCodes" @> OLD."sectorCodes") THEN RAISE EXCEPTION 'Review sector consolidation before merging employers'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_sector_merge_guard BEFORE UPDATE OF "mergedIntoId" ON "Company" FOR EACH ROW EXECUTE FUNCTION guard_merged_sector_memberships();

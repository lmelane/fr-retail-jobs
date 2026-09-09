CREATE TABLE "SectorConcept" (code TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, labels JSONB NOT NULL, definition TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE "SectorReview" (id TEXT PRIMARY KEY, manifest JSONB NOT NULL, "before" JSONB NOT NULL, reviewer TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
ALTER TABLE "Company" ADD COLUMN "sectorCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "sectorEvidence" JSONB, ADD COLUMN "sectorReviewId" TEXT REFERENCES "SectorReview"(id) ON DELETE RESTRICT;
CREATE INDEX "Company_sectorCodes_idx" ON "Company" USING GIN ("sectorCodes");
INSERT INTO "SectorConcept" VALUES ('FASHION','mode','{"fr": "Mode", "en": "Clothing and fashion collections"}'::jsonb,'Clothing and fashion collections',0);
INSERT INTO "SectorConcept" VALUES ('LEATHER_GOODS','maroquinerie','{"fr": "Maroquinerie", "en": "Leather goods and saddlery"}'::jsonb,'Leather goods and saddlery',1);
INSERT INTO "SectorConcept" VALUES ('FOOTWEAR','chaussures','{"fr": "Chaussures", "en": "Footwear"}'::jsonb,'Footwear',2);
INSERT INTO "SectorConcept" VALUES ('JEWELRY','joaillerie','{"fr": "Joaillerie", "en": "Jewelry"}'::jsonb,'Jewelry',3);
INSERT INTO "SectorConcept" VALUES ('WATCHMAKING','horlogerie','{"fr": "Horlogerie", "en": "Watches and watchmaking"}'::jsonb,'Watches and watchmaking',4);
INSERT INTO "SectorConcept" VALUES ('BEAUTY','beaute','{"fr": "Beauté", "en": "Cosmetics, makeup and skin or hair care"}'::jsonb,'Cosmetics, makeup and skin or hair care',5);
INSERT INTO "SectorConcept" VALUES ('FRAGRANCE','parfumerie','{"fr": "Parfumerie", "en": "Perfumes and fragrances"}'::jsonb,'Perfumes and fragrances',6);
INSERT INTO "SectorConcept" VALUES ('EYEWEAR','lunetterie','{"fr": "Lunetterie", "en": "Eyewear"}'::jsonb,'Eyewear',7);
INSERT INTO "SectorConcept" VALUES ('HOME_LIFESTYLE','maison-lifestyle','{"fr": "Maison & Lifestyle", "en": "Homeware, furniture and lifestyle objects"}'::jsonb,'Homeware, furniture and lifestyle objects',8);
INSERT INTO "SectorConcept" VALUES ('WINES_SPIRITS','vins-spiritueux','{"fr": "Vins & Spiritueux", "en": "Wine, champagne and spirits"}'::jsonb,'Wine, champagne and spirits',9);
INSERT INTO "SectorConcept" VALUES ('HOSPITALITY','hospitality','{"fr": "Hospitality", "en": "Luxury hospitality and travel"}'::jsonb,'Luxury hospitality and travel',10);
INSERT INTO "SectorConcept" VALUES ('LUXURY_MOBILITY','automobile-mobilite-luxe','{"fr": "Automobile & Mobilité de luxe", "en": "Luxury automobiles and mobility"}'::jsonb,'Luxury automobiles and mobility',11);
INSERT INTO "SectorConcept" VALUES ('ART_DESIGN','art-design','{"fr": "Art & Design", "en": "Art and design"}'::jsonb,'Art and design',12);
INSERT INTO "SectorConcept" VALUES ('RETAIL','retail','{"fr": "Retail", "en": "Retail distribution as an employer activity"}'::jsonb,'Retail distribution as an employer activity; not a job family',13);
INSERT INTO "SectorConcept" VALUES ('LUXURY_TECH_SERVICES','luxury-tech-services','{"fr": "Luxury Tech & Services", "en": "Technology and services specialized in this vertical"}'::jsonb,'Technology and services specialized in this vertical; not generic IT',14);

CREATE FUNCTION validate_company_sectors() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF cardinality(NEW."sectorCodes") <> (SELECT count(DISTINCT x) FROM unnest(NEW."sectorCodes") x) OR EXISTS (SELECT 1 FROM unnest(NEW."sectorCodes") x LEFT JOIN "SectorConcept" s ON s.code=x WHERE s.code IS NULL) THEN
  RAISE EXCEPTION 'Invalid or duplicate sector code';
 END IF;
 IF TG_OP='INSERT' AND cardinality(NEW."sectorCodes")=0 THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW."sectorCodes" IS NOT DISTINCT FROM OLD."sectorCodes" AND NEW."sectorEvidence" IS NOT DISTINCT FROM OLD."sectorEvidence" AND NEW."sectorReviewId" IS NOT DISTINCT FROM OLD."sectorReviewId" THEN RETURN NEW; END IF;
 IF NEW."sectorReviewId" IS NULL OR NOT EXISTS (SELECT 1 FROM "SectorReview" r, jsonb_array_elements(r.manifest->'companies') item WHERE r.id=NEW."sectorReviewId" AND item->>'id'=NEW.id AND item->>'canonicalKey'=NEW."canonicalKey" AND item->'codes'=to_jsonb(NEW."sectorCodes") AND item->'evidence'=NEW."sectorEvidence") THEN
  RAISE EXCEPTION 'Sector membership requires an exact reviewed manifest';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_sectors_review BEFORE INSERT OR UPDATE OF "sectorCodes","sectorEvidence","sectorReviewId" ON "Company" FOR EACH ROW EXECUTE FUNCTION validate_company_sectors();
CREATE FUNCTION protect_sector_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Sector reviews are immutable'; END $$;
CREATE TRIGGER sector_review_immutable BEFORE UPDATE OR DELETE ON "SectorReview" FOR EACH ROW EXECUTE FUNCTION protect_sector_review();

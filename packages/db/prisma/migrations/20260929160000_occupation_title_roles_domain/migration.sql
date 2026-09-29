-- Lot 2B de D-475 (plan docs/architecture/classification-metiers.md §3.1 et §3.3) : ADDITIVE, rien retiré.
-- À appliquer hors RUN, après contrôle de pg_stat_activity : une attente de verrou abandonne la migration au lieu de
-- faire attendre l'API derrière elle (audit du lot 2B-3a).
SET lock_timeout = '5s';

-- 1. Les clés de chaque version du catalogue (métiers, familles, domaines), indexées : les déclencheurs d'intégrité y
--    lisent une clé au lieu de relire tout le manifeste à chaque ligne (la v3 pèse 4,6 Mo ; reclasser 80 000 offres en
--    relisant le manifeste coûterait des minutes). Remplie pour les versions présentes, puis à chaque version publiée.
CREATE TABLE "OccupationReleaseConcept" (
  "releaseId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "family" TEXT,
  "domain" TEXT,
  CONSTRAINT "OccupationReleaseConcept_pkey" PRIMARY KEY ("releaseId","kind","key"),
  CONSTRAINT occupation_release_concept_kind CHECK ("kind" IN ('occupation','family','domain'))
);
ALTER TABLE "OccupationReleaseConcept" ADD CONSTRAINT "OccupationReleaseConcept_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "OccupationRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION index_occupation_release(release_id text, document jsonb) RETURNS void LANGUAGE sql AS $$
 INSERT INTO "OccupationReleaseConcept" ("releaseId","kind","key","family","domain")
  SELECT release_id, 'occupation', x->>'key', x->>'family', NULL FROM jsonb_array_elements(document->'occupations') x
  UNION ALL SELECT release_id, 'family', x->>'key', NULL, x->>'group' FROM jsonb_array_elements(document->'families') x
  UNION ALL SELECT release_id, 'domain', x->>'key', NULL, NULL FROM jsonb_array_elements(document->'groups') x;
$$;
SELECT index_occupation_release(id, manifest) FROM "OccupationRelease";
CREATE FUNCTION index_published_occupation_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM index_occupation_release(NEW.id, NEW.manifest); RETURN NEW; END;
$$;
CREATE TRIGGER occupation_release_index AFTER INSERT ON "OccupationRelease" FOR EACH ROW EXECUTE FUNCTION index_published_occupation_release();
-- Les clés d'une version sont des preuves, comme la version elle-même.
CREATE TRIGGER occupation_release_concept_immutable BEFORE UPDATE OR DELETE ON "OccupationReleaseConcept" FOR EACH ROW EXECUTE FUNCTION protect_occupation_evidence();

-- 2. Rôles lus dans le titre (`titleRoles`) et la version qui les a lus, sur Job et DirectOffer ; domaine
--    (`occupationDomain`), le niveau au-dessus de la famille (métier › famille › domaine) : la colonne
--    `occupationGroup`, retirée le 16/09 faute de lecteur (20260916230000_f1_legacy_effectif), revient sous ce nom.
--    Un tableau vide et des nulls par défaut : ajout sans réécriture de la table.
ALTER TABLE "Job"
  ADD COLUMN "titleRoles" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "titleRolesReleaseId" TEXT,
  ADD COLUMN "occupationDomain" TEXT;
ALTER TABLE "DirectOffer"
  ADD COLUMN "titleRoles" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "titleRolesReleaseId" TEXT,
  ADD COLUMN "occupationDomain" TEXT;
ALTER TABLE "Job" ADD CONSTRAINT "Job_titleRolesReleaseId_fkey" FOREIGN KEY ("titleRolesReleaseId") REFERENCES "OccupationRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DirectOffer" ADD CONSTRAINT "DirectOffer_titleRolesReleaseId_fkey" FOREIGN KEY ("titleRolesReleaseId") REFERENCES "OccupationRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT job_title_roles_versioned CHECK (cardinality("titleRoles") = 0 OR "titleRolesReleaseId" IS NOT NULL);
ALTER TABLE "DirectOffer" ADD CONSTRAINT direct_offer_title_roles_versioned CHECK (cardinality("titleRoles") = 0 OR "titleRolesReleaseId" IS NOT NULL);
-- Filtre « metier=X ou X lu dans le titre » (plan §3.5), sans dépendre de l'index de recherche.
CREATE INDEX "Job_titleRoles_idx" ON "Job" USING GIN ("titleRoles");
CREATE INDEX "DirectOffer_titleRoles_idx" ON "DirectOffer" USING GIN ("titleRoles");

-- 3. Chaque rôle lu appartient aux métiers de la version qui l'a lu. Sans version, la contrainte nommée
--    job_title_roles_versioned refuse d'elle-même.
CREATE FUNCTION validate_title_roles() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inconnu text;
BEGIN
 IF cardinality(NEW."titleRoles") = 0 OR NEW."titleRolesReleaseId" IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW."titleRoles",NEW."titleRolesReleaseId") IS NOT DISTINCT FROM ROW(OLD."titleRoles",OLD."titleRolesReleaseId") THEN RETURN NEW; END IF;
 SELECT r INTO inconnu FROM unnest(NEW."titleRoles") r WHERE NOT EXISTS (
  SELECT 1 FROM "OccupationReleaseConcept" c WHERE c."releaseId"=NEW."titleRolesReleaseId" AND c."kind"='occupation' AND c."key"=r) LIMIT 1;
 IF inconnu IS NOT NULL THEN RAISE EXCEPTION 'Title role % unknown to release % for %',inconnu,NEW."titleRolesReleaseId",NEW.id; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER job_title_roles_integrity BEFORE INSERT OR UPDATE OF "titleRoles","titleRolesReleaseId" ON "Job" FOR EACH ROW EXECUTE FUNCTION validate_title_roles();
CREATE TRIGGER direct_offer_title_roles_integrity BEFORE INSERT OR UPDATE OF "titleRoles","titleRolesReleaseId" ON "DirectOffer" FOR EACH ROW EXECUTE FUNCTION validate_title_roles();

-- 4. Intégrité d'un Job, sur la table des clés (mêmes contrôles et mêmes messages qu'avant) ; le domaine est CALCULÉ,
--    celui de la famille dans la version citée, jamais demandé à l'écrivain : un reclassement d'une famille à une autre
--    ne peut pas échouer sur un domaine oublié (audit du lot 2B-3a), et une valeur écrite à la main est remplacée.
CREATE OR REPLACE FUNCTION validate_job_occupation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE famille text; domaine text;
BEGIN
 IF NEW."occupationReleaseId" IS NULL THEN NEW."occupationDomain" := NULL; RETURN NEW; END IF;
 IF NEW."occupationCode" IS NOT NULL THEN
  SELECT c."family" INTO famille FROM "OccupationReleaseConcept" c WHERE c."releaseId"=NEW."occupationReleaseId" AND c."kind"='occupation' AND c."key"=NEW."occupationCode";
  IF famille IS NULL OR famille IS DISTINCT FROM NEW."jobFunction" THEN RAISE EXCEPTION 'Occupation/family mismatch for %',NEW.id; END IF;
 END IF;
 IF NEW."jobFunction" IS NOT NULL THEN
  SELECT c."domain" INTO domaine FROM "OccupationReleaseConcept" c WHERE c."releaseId"=NEW."occupationReleaseId" AND c."kind"='family' AND c."key"=NEW."jobFunction";
  IF NOT FOUND THEN RAISE EXCEPTION 'Occupation family unknown to release for %',NEW.id; END IF;
 END IF;
 NEW."occupationDomain" := domaine;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS job_occupation_integrity ON "Job";
CREATE TRIGGER job_occupation_integrity BEFORE INSERT OR UPDATE OF "occupationReleaseId","occupationCode","jobFunction","occupationDomain" ON "Job" FOR EACH ROW EXECUTE FUNCTION validate_job_occupation();

-- 5. Le domaine d'une offre Catwalks : calculé de même, depuis la famille de son métier (DirectOffer ne stocke pas de
--    famille) ; un métier inconnu de la version citée est refusé avec son propre message.
CREATE FUNCTION compute_direct_offer_domain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE famille text; domaine text;
BEGIN
 IF NEW."occupationReleaseId" IS NULL OR NEW."occupationCode" IS NULL THEN NEW."occupationDomain" := NULL; RETURN NEW; END IF;
 SELECT c."family" INTO famille FROM "OccupationReleaseConcept" c WHERE c."releaseId"=NEW."occupationReleaseId" AND c."kind"='occupation' AND c."key"=NEW."occupationCode";
 IF NOT FOUND THEN RAISE EXCEPTION 'Occupation % unknown to release % for %',NEW."occupationCode",NEW."occupationReleaseId",NEW.id; END IF;
 SELECT c."domain" INTO domaine FROM "OccupationReleaseConcept" c WHERE c."releaseId"=NEW."occupationReleaseId" AND c."kind"='family' AND c."key"=famille;
 NEW."occupationDomain" := domaine;
 RETURN NEW;
END;
$$;
CREATE TRIGGER direct_offer_domain BEFORE INSERT OR UPDATE OF "occupationReleaseId","occupationCode","occupationDomain" ON "DirectOffer" FOR EACH ROW EXECUTE FUNCTION compute_direct_offer_domain();

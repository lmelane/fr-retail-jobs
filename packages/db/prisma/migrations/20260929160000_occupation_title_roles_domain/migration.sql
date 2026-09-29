-- Lot 2B de D-475 (plan docs/architecture/classification-metiers.md §3.1 et §3.3) : colonnes ADDITIVES, rien retiré.
--
-- 1. Rôles lus dans le titre (`titleRoles`) et la version du manifeste qui les a lus (`titleRolesReleaseId`), sur
--    Job et DirectOffer : un tableau vide et une version nulle par défaut (ajout sans réécriture de la table). Un rôle
--    lu porte toujours sa version, et chaque rôle appartient aux métiers de cette version.
-- 2. Domaine (`occupationDomain`), le niveau au-dessus de la famille (hiérarchie métier › famille › domaine) : la
--    colonne `occupationGroup`, retirée le 16/09 faute de lecteur (20260916230000_f1_legacy_effectif), revient sous un
--    nom qui dit ce niveau. Il est celui de la famille dans la version citée, ou un domaine de cette version.

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
ALTER TABLE "Job" ADD CONSTRAINT job_occupation_domain_versioned CHECK ("occupationDomain" IS NULL OR "occupationReleaseId" IS NOT NULL);
ALTER TABLE "DirectOffer" ADD CONSTRAINT direct_offer_occupation_domain_versioned CHECK ("occupationDomain" IS NULL OR "occupationReleaseId" IS NOT NULL);

-- Filtre de recherche « metier=X ou X lu dans le titre » (plan §3.5), sans dépendre de l'index de recherche.
CREATE INDEX "Job_titleRoles_idx" ON "Job" USING GIN ("titleRoles");
CREATE INDEX "DirectOffer_titleRoles_idx" ON "DirectOffer" USING GIN ("titleRoles");

-- Chaque rôle lu appartient aux métiers de la version qui l'a lu.
CREATE FUNCTION validate_title_roles() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document jsonb; inconnu text;
BEGIN
 -- Sans version, la contrainte job_title_roles_versioned refuse, avec son nom : rien à vérifier ici.
 IF cardinality(NEW."titleRoles") = 0 OR NEW."titleRolesReleaseId" IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW."titleRoles",NEW."titleRolesReleaseId") IS NOT DISTINCT FROM ROW(OLD."titleRoles",OLD."titleRolesReleaseId") THEN RETURN NEW; END IF;
 SELECT manifest INTO STRICT document FROM "OccupationRelease" WHERE id=NEW."titleRolesReleaseId";
 SELECT r INTO inconnu FROM unnest(NEW."titleRoles") r
  WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(document->'occupations') x WHERE x->>'key'=r) LIMIT 1;
 IF inconnu IS NOT NULL THEN RAISE EXCEPTION 'Title role % unknown to release % for %',inconnu,NEW."titleRolesReleaseId",NEW.id; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER job_title_roles_integrity BEFORE INSERT OR UPDATE OF "titleRoles","titleRolesReleaseId" ON "Job" FOR EACH ROW EXECUTE FUNCTION validate_title_roles();
CREATE TRIGGER direct_offer_title_roles_integrity BEFORE INSERT OR UPDATE OF "titleRoles","titleRolesReleaseId" ON "DirectOffer" FOR EACH ROW EXECUTE FUNCTION validate_title_roles();

-- Le domaine d'un Job : celui de sa famille dans la version citée, sinon un domaine de cette version.
CREATE OR REPLACE FUNCTION validate_job_occupation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document jsonb; definition jsonb; family jsonb;
BEGIN
 IF NEW."occupationReleaseId" IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW."occupationReleaseId",NEW."occupationCode",NEW."jobFunction",NEW."occupationDomain") IS NOT DISTINCT FROM ROW(OLD."occupationReleaseId",OLD."occupationCode",OLD."jobFunction",OLD."occupationDomain") THEN RETURN NEW; END IF;
 SELECT manifest INTO STRICT document FROM "OccupationRelease" WHERE id=NEW."occupationReleaseId";
 IF NEW."occupationCode" IS NOT NULL THEN
  SELECT x INTO definition FROM jsonb_array_elements(document->'occupations') x WHERE x->>'key'=NEW."occupationCode";
  IF definition IS NULL OR definition->>'family' IS DISTINCT FROM NEW."jobFunction" THEN RAISE EXCEPTION 'Occupation/family mismatch for %',NEW.id; END IF;
 END IF;
 IF NEW."jobFunction" IS NOT NULL THEN
  SELECT x INTO family FROM jsonb_array_elements(document->'families') x WHERE x->>'key'=NEW."jobFunction";
  IF family IS NULL THEN RAISE EXCEPTION 'Occupation family unknown to release for %',NEW.id; END IF;
 END IF;
 IF NEW."occupationDomain" IS NOT NULL THEN
  IF family IS NOT NULL AND family->>'group' IS DISTINCT FROM NEW."occupationDomain" THEN RAISE EXCEPTION 'Occupation domain/family mismatch for %',NEW.id; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(document->'groups') g WHERE g->>'key'=NEW."occupationDomain") THEN RAISE EXCEPTION 'Occupation domain unknown to release for %',NEW.id; END IF;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS job_occupation_integrity ON "Job";
CREATE TRIGGER job_occupation_integrity BEFORE INSERT OR UPDATE OF "occupationReleaseId","occupationCode","jobFunction","occupationDomain" ON "Job" FOR EACH ROW EXECUTE FUNCTION validate_job_occupation();

-- Le domaine d'une offre Catwalks : celui de la famille de son métier dans la version citée, sinon un domaine de
-- cette version (DirectOffer n'a pas de famille stockée).
CREATE FUNCTION validate_direct_offer_domain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document jsonb; famille text;
BEGIN
 IF NEW."occupationDomain" IS NULL OR NEW."occupationReleaseId" IS NULL THEN RETURN NEW; END IF;
 SELECT manifest INTO STRICT document FROM "OccupationRelease" WHERE id=NEW."occupationReleaseId";
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(document->'groups') g WHERE g->>'key'=NEW."occupationDomain") THEN RAISE EXCEPTION 'Occupation domain unknown to release for %',NEW.id; END IF;
 IF NEW."occupationCode" IS NOT NULL THEN
  SELECT x->>'family' INTO famille FROM jsonb_array_elements(document->'occupations') x WHERE x->>'key'=NEW."occupationCode";
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(document->'families') f WHERE f->>'key'=famille AND f->>'group'=NEW."occupationDomain") THEN
   RAISE EXCEPTION 'Occupation domain/occupation mismatch for %',NEW.id; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER direct_offer_domain_integrity BEFORE INSERT OR UPDATE OF "occupationReleaseId","occupationCode","occupationDomain" ON "DirectOffer" FOR EACH ROW EXECUTE FUNCTION validate_direct_offer_domain();

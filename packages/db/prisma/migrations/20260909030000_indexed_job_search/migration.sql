BEGIN;
SET LOCAL lock_timeout = '2s';

CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER TABLE "Job" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';

CREATE FUNCTION catwalks_job_search_text(
  title text, description text, city text, location text, department text,
  employment_term text, company_name text, parent_group text
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(title,'') || ' ' || coalesce(description,'') || ' ' ||
    coalesce(city,'') || ' ' || coalesce(location,'') || ' ' || coalesce(department,'') || ' ' ||
    coalesce(employment_term,'') || ' ' || coalesce(company_name,'') || ' ' || coalesce(parent_group,'');
$$;

CREATE FUNCTION catwalks_refresh_job_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT catwalks_job_search_text(NEW.title,NEW.description,NEW.city,NEW.location,NEW.department,
    NEW."employmentTerm",c.name,c."parentGroup") INTO NEW."searchText"
  FROM "Company" c WHERE c.id=NEW."companyId";
  RETURN NEW;
END;
$$;
CREATE TRIGGER catwalks_job_search_before_write
  BEFORE INSERT OR UPDATE OF title,description,city,location,department,"employmentTerm","companyId"
  ON "Job" FOR EACH ROW EXECUTE FUNCTION catwalks_refresh_job_search();

CREATE FUNCTION catwalks_refresh_company_job_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Job" SET "searchText" = catwalks_job_search_text(title,description,city,location,department,
    "employmentTerm",NEW.name,NEW."parentGroup") WHERE "companyId"=NEW.id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER catwalks_company_search_after_write
  AFTER UPDATE OF name,"parentGroup" ON "Company" FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD."parentGroup" IS DISTINCT FROM NEW."parentGroup")
  EXECUTE FUNCTION catwalks_refresh_company_job_search();

COMMIT;

-- The reviewed FK is authoritative. Keep the legacy display column consistent
-- while consumers and historical unreviewed relationships are migrated.
CREATE FUNCTION enforce_company_parent_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_name text; parent_kind "CompanyKind"; parent_redirect text; found_cycle boolean;
BEGIN
  IF NEW."parentGroupId" IS NOT NULL THEN
    SELECT name, kind, "mergedIntoId" INTO parent_name, parent_kind, parent_redirect
      FROM "Company" WHERE id=NEW."parentGroupId";
    IF parent_kind IS DISTINCT FROM 'GROUP' OR parent_redirect IS NOT NULL THEN
      RAISE EXCEPTION 'Parent % must be a canonical GROUP', NEW."parentGroupId";
    END IF;
    WITH RECURSIVE ancestors AS (
      SELECT id, "parentGroupId", ARRAY[id] AS path FROM "Company" WHERE id=NEW."parentGroupId"
      UNION ALL SELECT c.id, c."parentGroupId", a.path || c.id
      FROM ancestors a JOIN "Company" c ON c.id=a."parentGroupId" WHERE NOT c.id=ANY(a.path)
    ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=NEW.id) INTO found_cycle;
    IF found_cycle THEN RAISE EXCEPTION 'Employer parent cycle at %', NEW.id; END IF;
    NEW."parentGroup" := parent_name;
  ELSIF TG_OP='UPDATE' AND OLD."parentGroupId" IS NOT NULL THEN
    NEW."parentGroup" := NULL;
  END IF;
  IF (NEW.kind <> 'GROUP' OR NEW."mergedIntoId" IS NOT NULL) AND EXISTS (SELECT 1 FROM "Company" WHERE "parentGroupId"=NEW.id) THEN
    RAISE EXCEPTION 'A referenced parent must remain a canonical GROUP: %', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER company_parent_identity BEFORE INSERT OR UPDATE OF "parentGroupId", "parentGroup", kind, "mergedIntoId" ON "Company"
FOR EACH ROW EXECUTE FUNCTION enforce_company_parent_identity();
CREATE FUNCTION refresh_company_parent_name() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE "Company" SET "parentGroup"=NEW.name WHERE "parentGroupId"=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER company_parent_name AFTER UPDATE OF name ON "Company"
FOR EACH ROW EXECUTE FUNCTION refresh_company_parent_name();

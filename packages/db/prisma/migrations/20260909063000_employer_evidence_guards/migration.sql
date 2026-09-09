ALTER TABLE "EmployerObservation" ADD COLUMN "labelOrigin" TEXT NOT NULL DEFAULT 'LEGACY_UNSPECIFIED';
ALTER TABLE "Company" ADD CONSTRAINT "Company_no_self_merge" CHECK ("mergedIntoId" IS DISTINCT FROM id);
ALTER TABLE "Company" ADD CONSTRAINT "Company_no_self_parent" CHECK ("parentGroupId" IS DISTINCT FROM id);
ALTER TABLE "CompanyAlias" ADD CONSTRAINT "CompanyAlias_reviewed_label" CHECK ("reviewId" IS NULL OR ("normalizedName" IS NOT NULL AND length("normalizedName") > 0));
CREATE FUNCTION prevent_employer_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; record a new reviewed decision', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER employer_review_immutable BEFORE UPDATE OR DELETE ON "EmployerIdentityReview"
FOR EACH ROW EXECUTE FUNCTION prevent_employer_evidence_mutation();
CREATE TRIGGER employer_observation_immutable BEFORE UPDATE OR DELETE ON "EmployerObservation"
FOR EACH ROW EXECUTE FUNCTION prevent_employer_evidence_mutation();

ALTER TABLE "Company" ADD COLUMN "identityReviewId" TEXT;
-- Preserve evidence links if a rehearsal/previous installation already applied
-- an identity plan. No company relationship is inferred from a label.
UPDATE "Company" c SET "identityReviewId"=proof."batchId"
FROM (
  SELECT DISTINCT ON (d."entityId") d."entityId",d."batchId"
  FROM "DataCorrection" d JOIN "EmployerIdentityReview" r ON r.id=d."batchId"
  WHERE d."entityType"='Company' AND (d.after ? 'mergedIntoId' OR d.after ? 'parentGroupId')
  ORDER BY d."entityId",d."createdAt" DESC
) proof WHERE c.id=proof."entityId";
ALTER TABLE "Company" ADD CONSTRAINT "Company_identityReviewId_fkey" FOREIGN KEY ("identityReviewId") REFERENCES "EmployerIdentityReview"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Company" ADD CONSTRAINT "Company_identity_relationship_review" CHECK (("mergedIntoId" IS NULL AND "parentGroupId" IS NULL) OR "identityReviewId" IS NOT NULL);

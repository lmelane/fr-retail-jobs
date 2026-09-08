CREATE TABLE "DataCorrection" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "planHash" TEXT NOT NULL,
  "commitHash" TEXT NOT NULL,
  "finding" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataCorrection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DataCorrection_batchId_entityType_entityId_key" ON "DataCorrection"("batchId", "entityType", "entityId");
CREATE INDEX "DataCorrection_entityType_entityId_idx" ON "DataCorrection"("entityType", "entityId");
CREATE FUNCTION prevent_correction_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DataCorrection is append-only; record a compensating correction';
END;
$$;
CREATE TRIGGER correction_evidence_immutable BEFORE UPDATE OR DELETE ON "DataCorrection"
FOR EACH ROW EXECUTE FUNCTION prevent_correction_evidence_mutation();

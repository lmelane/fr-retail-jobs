CREATE TABLE "SourceExtraction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "batchId" TEXT NOT NULL REFERENCES "CaptureBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" >= 0),
  "externalId" TEXT,
  "outputHash" TEXT NOT NULL REFERENCES "RawBlob"("hash") ON DELETE RESTRICT ON UPDATE CASCADE,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SourceExtraction_id_batchId_key" ON "SourceExtraction"("id", "batchId");
CREATE UNIQUE INDEX "SourceExtraction_batchId_ordinal_key" ON "SourceExtraction"("batchId", "ordinal");
CREATE INDEX "SourceExtraction_outputHash_idx" ON "SourceExtraction"("outputHash");
CREATE TRIGGER "SourceExtraction_immutable" BEFORE UPDATE OR DELETE ON "SourceExtraction"
  FOR EACH ROW EXECUTE FUNCTION protect_capture_evidence();
ALTER TABLE "JobSource" ADD COLUMN "captureOutputId" TEXT;
ALTER TABLE "SourceObservation" ADD COLUMN "captureOutputId" TEXT;
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_captureOutputId_captureBatchId_fkey"
  FOREIGN KEY ("captureOutputId", "captureBatchId") REFERENCES "SourceExtraction"("id", "batchId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceObservation" ADD CONSTRAINT "SourceObservation_captureOutputId_captureBatchId_fkey"
  FOREIGN KEY ("captureOutputId", "captureBatchId") REFERENCES "SourceExtraction"("id", "batchId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_output_has_batch" CHECK ("captureOutputId" IS NULL OR "captureBatchId" IS NOT NULL);
ALTER TABLE "SourceObservation" ADD CONSTRAINT "SourceObservation_output_has_batch" CHECK ("captureOutputId" IS NULL OR "captureBatchId" IS NOT NULL);
CREATE INDEX "JobSource_captureOutputId_captureBatchId_idx" ON "JobSource"("captureOutputId", "captureBatchId");
CREATE INDEX "SourceObservation_captureOutputId_captureBatchId_idx" ON "SourceObservation"("captureOutputId", "captureBatchId");

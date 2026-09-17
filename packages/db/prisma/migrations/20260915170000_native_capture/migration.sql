-- AlterTable
ALTER TABLE "JobSource" ADD COLUMN     "captureBatchId" TEXT;

-- AlterTable
ALTER TABLE "SourceObservation" ADD COLUMN     "captureBatchId" TEXT;

-- CreateTable
CREATE TABLE "RawBlob" (
    "hash" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "gzipHash" TEXT NOT NULL,
    "gzipLength" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawBlob_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "RawBlobBody" (
    "hash" TEXT NOT NULL,
    "gzip" BYTEA NOT NULL,

    CONSTRAINT "RawBlobBody_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "RawBlobArchive" (
    "hash" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "gzipHash" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawBlobArchive_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "CaptureBatch" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "runId" TEXT,
    "configHash" TEXT NOT NULL,
    "readerRevision" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawCapture" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "requestHash" TEXT NOT NULL,
    "requestUrl" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" INTEGER,
    "headers" JSONB NOT NULL,
    "cookieNames" JSONB NOT NULL,
    "complete" BOOLEAN NOT NULL,
    "failure" TEXT,
    "blobHash" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawCapture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureOutcome" (
    "batchId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "extractedCount" INTEGER NOT NULL,
    "failure" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureOutcome_pkey" PRIMARY KEY ("batchId")
);

-- CreateIndex
CREATE INDEX "CaptureBatch_sourceKey_startedAt_idx" ON "CaptureBatch"("sourceKey", "startedAt");

-- CreateIndex
CREATE INDEX "CaptureBatch_runId_idx" ON "CaptureBatch"("runId");

-- CreateIndex
CREATE INDEX "RawCapture_blobHash_idx" ON "RawCapture"("blobHash");

-- CreateIndex
CREATE UNIQUE INDEX "RawCapture_batchId_sequence_key" ON "RawCapture"("batchId", "sequence");

-- CreateIndex
CREATE INDEX "JobSource_captureBatchId_idx" ON "JobSource"("captureBatchId");

-- AddForeignKey
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_captureBatchId_fkey" FOREIGN KEY ("captureBatchId") REFERENCES "CaptureBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceObservation" ADD CONSTRAINT "SourceObservation_captureBatchId_fkey" FOREIGN KEY ("captureBatchId") REFERENCES "CaptureBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawBlobBody" ADD CONSTRAINT "RawBlobBody_hash_fkey" FOREIGN KEY ("hash") REFERENCES "RawBlob"("hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawBlobArchive" ADD CONSTRAINT "RawBlobArchive_hash_fkey" FOREIGN KEY ("hash") REFERENCES "RawBlob"("hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawCapture" ADD CONSTRAINT "RawCapture_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CaptureBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawCapture" ADD CONSTRAINT "RawCapture_blobHash_fkey" FOREIGN KEY ("blobHash") REFERENCES "RawBlob"("hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureOutcome" ADD CONSTRAINT "CaptureOutcome_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CaptureBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Native evidence and outcomes are append-only. Storage location changes by
-- adding a verified archive pointer, never by changing an existing proof.
CREATE FUNCTION protect_capture_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is immutable', TG_TABLE_NAME; END;
$$;
CREATE TRIGGER "RawBlob_immutable" BEFORE UPDATE OR DELETE ON "RawBlob" FOR EACH ROW EXECUTE FUNCTION protect_capture_evidence();
CREATE TRIGGER "RawBlobArchive_immutable" BEFORE UPDATE OR DELETE ON "RawBlobArchive" FOR EACH ROW EXECUTE FUNCTION protect_capture_evidence();
CREATE TRIGGER "CaptureBatch_immutable" BEFORE UPDATE OR DELETE ON "CaptureBatch" FOR EACH ROW EXECUTE FUNCTION protect_capture_evidence();
CREATE TRIGGER "RawCapture_immutable" BEFORE UPDATE OR DELETE ON "RawCapture" FOR EACH ROW EXECUTE FUNCTION protect_capture_evidence();
CREATE TRIGGER "CaptureOutcome_immutable" BEFORE UPDATE OR DELETE ON "CaptureOutcome" FOR EACH ROW EXECUTE FUNCTION protect_capture_evidence();

CREATE FUNCTION protect_hot_raw_body() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'RawBlobBody is immutable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "RawBlobArchive" a JOIN "RawBlob" b ON b.hash = a.hash
    WHERE a.hash = OLD.hash AND a."gzipHash" = b."gzipHash") THEN
    RAISE EXCEPTION 'RawBlobBody cannot be deleted without a verified archive';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "RawBlobBody_retention_guard" BEFORE UPDATE OR DELETE ON "RawBlobBody"
  FOR EACH ROW EXECUTE FUNCTION protect_hot_raw_body();
ALTER TABLE "RawBlob" ADD CONSTRAINT "RawBlob_integrity_shape" CHECK
  (hash ~ '^[a-f0-9]{64}$' AND "gzipHash" ~ '^[a-f0-9]{64}$' AND "byteLength" BETWEEN 0 AND 20000000 AND "gzipLength" > 0);
ALTER TABLE "RawCapture" ADD CONSTRAINT "RawCapture_shape" CHECK
  (sequence >= 0 AND "requestHash" ~ '^[a-f0-9]{64}$' AND format IN ('HTTP_RESPONSE','BROWSER_RESPONSE','RENDERED_DOM')
   AND (status IS NULL OR status BETWEEN 100 AND 599) AND (NOT complete OR "blobHash" IS NOT NULL));
ALTER TABLE "CaptureOutcome" ADD CONSTRAINT "CaptureOutcome_shape" CHECK
  (status IN ('EXTRACTED','FAILED') AND "extractedCount" >= 0);

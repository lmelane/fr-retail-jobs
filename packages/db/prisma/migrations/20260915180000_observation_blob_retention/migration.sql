-- Production read-only inventory on 2026-09-15 found both obsolete tables empty.
-- Never discard an archive pointer if another database has used that older path.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "ObservationArchiveRef") OR EXISTS (SELECT 1 FROM "ObservationArchiveManifest") THEN
    RAISE EXCEPTION 'Existing legacy observation archives must be migrated before replacing their tables';
  END IF;
END $$;
-- AlterTable
ALTER TABLE "SourceObservation" ADD COLUMN     "rawBlobHash" TEXT,
ALTER COLUMN "raw" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CaptureBatch" ADD COLUMN     "formatVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "sourceKind" TEXT;

-- AlterTable
ALTER TABLE "CaptureOutcome" ADD COLUMN     "outputHash" TEXT;

-- DropTable
DROP TABLE "ObservationArchiveRef";

-- DropTable
DROP TABLE "ObservationArchiveManifest";

-- CreateIndex
CREATE INDEX "SourceObservation_rawBlobHash_idx" ON "SourceObservation"("rawBlobHash");

-- AddForeignKey
ALTER TABLE "SourceObservation" ADD CONSTRAINT "SourceObservation_rawBlobHash_fkey" FOREIGN KEY ("rawBlobHash") REFERENCES "RawBlob"("hash") ON DELETE RESTRICT ON UPDATE CASCADE;


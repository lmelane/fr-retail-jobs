-- DropIndex
DROP INDEX "SourceObservation_sourceKey_externalId_contentHash_key";

-- AlterTable
ALTER TABLE "SourceObservation" ADD COLUMN     "annotationHash" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "publicationHold" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SourceObservation_sourceKey_externalId_contentHash_annotati_key" ON "SourceObservation"("sourceKey", "externalId", "contentHash", "annotationHash");


-- The former archivePublicationHold writer used this explicit wrapper.
-- Preserve its original payload/hash; extract its internal disposition for querying.
UPDATE "SourceObservation" SET "publicationHold" = raw->>'publicationHold'
WHERE jsonb_typeof(raw->'publicationHold') = 'string' AND raw ? 'sourcePayload';

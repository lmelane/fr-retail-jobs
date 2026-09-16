BEGIN;
-- Lot 6 (D-423): the read copy of Catwalks direct offers, fed by the backend
-- outbox. Neon stays the truth; these rows are rebuilt from each version's
-- payload. Additive: no existing table is touched.
CREATE TABLE "DirectOffer" (
  id TEXT PRIMARY KEY,
  version BIGINT NOT NULL,
  "appliedSeq" BIGINT NOT NULL,
  eligible BOOLEAN NOT NULL,
  "payloadHash" TEXT NOT NULL,
  payload JSONB NOT NULL,
  "correspondanceVersion" INTEGER NOT NULL,
  slug TEXT NOT NULL,
  "anciensSlugs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  "maisonSlug" TEXT,
  "countryCode" TEXT,
  city TEXT,
  "postalCode" TEXT,
  location TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  "employmentTerm" TEXT,
  "workTime" TEXT,
  "programType" TEXT,
  "engagementType" TEXT,
  "workplaceType" TEXT,
  "sectorCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "occupationLabel" TEXT,
  language TEXT,
  description TEXT NOT NULL,
  "salaryMin" DECIMAL(24,6),
  "salaryMax" DECIMAL(24,6),
  "salaryCurrency" TEXT,
  "salaryPeriod" TEXT,
  visuel TEXT,
  "applyUrl" TEXT NOT NULL,
  "postedAt" TIMESTAMP(3) NOT NULL,
  "validThrough" TIMESTAMP(3),
  "modifiedAt" TIMESTAMP(3) NOT NULL,
  "searchText" TEXT NOT NULL DEFAULT '',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "DirectOffer_eligible_countryCode_idx" ON "DirectOffer"("eligible", "countryCode");
CREATE INDEX "DirectOffer_slug_idx" ON "DirectOffer"(slug);
CREATE INDEX "DirectOffer_company_idx" ON "DirectOffer"(company);
-- Same text-search shape as Job.searchText (pg_trgm is already installed).
CREATE INDEX "DirectOffer_searchText_trgm_idx" ON "DirectOffer" USING gin ("searchText" gin_trgm_ops) WHERE eligible;

-- Every feed event read, with its effect. Append only: the immutability
-- trigger shared with the capture evidence refuses UPDATE and DELETE.
CREATE TABLE "DirectOfferEvent" (
  seq BIGINT PRIMARY KEY,
  "offerId" TEXT NOT NULL,
  version BIGINT NOT NULL,
  evenement TEXT NOT NULL CHECK (evenement IN ('PUBLIE', 'RETIRE')),
  "payloadHash" TEXT,
  effet TEXT NOT NULL CHECK (effet IN ('APPLIQUE', 'STALE', 'INCONNU')),
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "DirectOfferEvent_offerId_idx" ON "DirectOfferEvent"("offerId");
CREATE TRIGGER "DirectOfferEvent_immutable" BEFORE UPDATE OR DELETE ON "DirectOfferEvent"
  FOR EACH ROW EXECUTE FUNCTION protect_capture_evidence();

CREATE TABLE "DirectFeedCursor" (
  id TEXT PRIMARY KEY,
  "lastSeq" BIGINT NOT NULL,
  "contractVersion" INTEGER NOT NULL,
  "lastReadAt" TIMESTAMP(3) NOT NULL,
  "lastError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
COMMIT;

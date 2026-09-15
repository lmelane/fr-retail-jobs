-- Native publications outlive their public presentation. Missing evidence is a
-- quarantine, never an employer closure or a reason to invent another Job.
ALTER TABLE "JobSource" ALTER COLUMN "jobId" DROP NOT NULL;
ALTER TABLE "JobSource" ADD COLUMN "quarantinedAt" TIMESTAMP(3);
ALTER TABLE "JobSource" ADD COLUMN "quarantineReason" TEXT;
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_quarantine_state" CHECK (
  ("jobId" IS NOT NULL AND "quarantinedAt" IS NULL AND "quarantineReason" IS NULL)
  OR ("jobId" IS NULL AND "quarantinedAt" IS NOT NULL AND "quarantineReason" IS NOT NULL
      AND length(trim("quarantineReason")) BETWEEN 1 AND 200)
);
ALTER TABLE "JobSource" DROP CONSTRAINT "JobSource_jobId_fkey";
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PublicationIdentityDecision" ALTER COLUMN "toJobId" DROP NOT NULL;
ALTER TABLE "PublicationIdentityDecision" DROP CONSTRAINT "PublicationIdentityDecision_action_check";
ALTER TABLE "PublicationIdentityDecision" ADD CONSTRAINT "PublicationIdentityDecision_action_check"
  CHECK (action IN ('ATTACHED', 'MOVED', 'SEPARATED', 'RESTORED', 'QUARANTINED', 'RELEASED'));
ALTER TABLE "PublicationIdentityDecision" ADD CONSTRAINT "PublicationIdentityDecision_quarantine_direction" CHECK (
  (action='QUARANTINED' AND "fromJobId" IS NOT NULL AND "toJobId" IS NULL)
  OR (action='RELEASED' AND "fromJobId" IS NULL AND "toJobId" IS NOT NULL)
  OR (action NOT IN ('QUARANTINED', 'RELEASED') AND "toJobId" IS NOT NULL)
);

CREATE OR REPLACE FUNCTION protect_publication_quarantine() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- New native publications enter through qualified ingestion. Historical
  -- detachment and release require their own immutable, transaction-bound audit.
  IF TG_OP='INSERT' THEN
    IF NEW."jobId" IS NULL THEN
      RAISE EXCEPTION 'New publication requires a qualified presentation';
    END IF;
  ELSIF OLD."jobId" IS NOT DISTINCT FROM NEW."jobId"
    AND ROW(OLD."quarantinedAt", OLD."quarantineReason") IS DISTINCT FROM ROW(NEW."quarantinedAt", NEW."quarantineReason") THEN
    RAISE EXCEPTION 'Quarantine metadata changes require a publication transition';
  ELSIF (OLD."jobId" IS NULL) IS DISTINCT FROM (NEW."jobId" IS NULL) THEN
    IF NOT EXISTS (
      SELECT 1 FROM "PublicationIdentityDecision" d
      WHERE d."sourceId"=NEW.id AND d."transactionId"=txid_current()
        AND d."fromJobId" IS NOT DISTINCT FROM OLD."jobId"
        AND d."toJobId" IS NOT DISTINCT FROM NEW."jobId"
        AND ((NEW."jobId" IS NULL AND d.action='QUARANTINED'
          AND d.evidence->>'rule'='REVIEWED_PUBLICATION_PARTITION'
          AND d.evidence->>'quarantineReason'=NEW."quarantineReason"
          AND EXISTS (SELECT 1 FROM "MaintenancePlan" p
            WHERE p.id=d.evidence->>'planHash' AND p.kind='PUBLICATION_GROUP_REPAIR'))
          OR (OLD."jobId" IS NULL AND d.action='RELEASED'
            AND d.evidence->>'rule'='QUALIFIED_NATIVE_REOBSERVATION'))
    ) THEN
      RAISE EXCEPTION 'Publication quarantine transition requires a compensating decision';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "JobSource_quarantine_transition" BEFORE INSERT OR UPDATE OF "jobId", "quarantinedAt", "quarantineReason" ON "JobSource"
  FOR EACH ROW EXECUTE FUNCTION protect_publication_quarantine();

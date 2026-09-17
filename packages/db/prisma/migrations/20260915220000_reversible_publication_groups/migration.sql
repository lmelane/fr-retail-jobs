-- Historical decisions have no transaction binding. New compensating decisions
-- authorize restoration only in the transaction that appends them.
ALTER TABLE "PublicationIdentityDecision" ADD COLUMN "transactionId" BIGINT;
ALTER TABLE "PublicationIdentityDecision" ALTER COLUMN "transactionId" SET DEFAULT txid_current();

CREATE OR REPLACE FUNCTION preserve_job_redirect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."mergedIntoId" IS NOT NULL AND NEW."mergedIntoId" IS DISTINCT FROM OLD."mergedIntoId" THEN
    IF NEW."mergedIntoId" IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM "PublicationIdentityDecision" d
      JOIN "MaintenancePlan" p ON p.id = d.evidence->>'planHash'
      WHERE d."toJobId"=OLD.id AND d.action='RESTORED'
        AND d."transactionId"=txid_current()
        AND d.evidence->>'previousRedirect'=OLD."mergedIntoId"
        AND d.evidence->>'rule'='REVIEWED_PUBLICATION_PARTITION'
        AND p.kind='PUBLICATION_GROUP_REPAIR'
    ) THEN
      RAISE EXCEPTION 'Job redirect restoration requires a compensating publication plan: %', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

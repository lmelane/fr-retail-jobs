CREATE TABLE "PublicationIdentityDecision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceId" TEXT NOT NULL,
  "fromJobId" TEXT,
  "toJobId" TEXT NOT NULL,
  "action" TEXT NOT NULL CHECK ("action" IN ('ATTACHED', 'MOVED', 'SEPARATED', 'RESTORED')),
  "readerVersion" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("fromJobId" IS DISTINCT FROM "toJobId")
);
CREATE INDEX "PublicationIdentityDecision_sourceId_createdAt_idx" ON "PublicationIdentityDecision"("sourceId", "createdAt");
CREATE INDEX "PublicationIdentityDecision_toJobId_createdAt_idx" ON "PublicationIdentityDecision"("toJobId", "createdAt");
-- Evidence deliberately has no cascading relation to mutable presentation groups.
CREATE FUNCTION protect_publication_identity_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Publication identity decisions are immutable; append a compensating decision';
END $$;
CREATE TRIGGER "PublicationIdentityDecision_immutable" BEFORE UPDATE OR DELETE ON "PublicationIdentityDecision"
  FOR EACH ROW EXECUTE FUNCTION protect_publication_identity_decision();

CREATE FUNCTION preserve_native_publication_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW."sourceKey", NEW."externalId") IS DISTINCT FROM ROW(OLD.id, OLD."sourceKey", OLD."externalId") THEN
    RAISE EXCEPTION 'Native publication identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "JobSource_native_identity" BEFORE UPDATE OF id, "sourceKey", "externalId" ON "JobSource"
  FOR EACH ROW EXECUTE FUNCTION preserve_native_publication_identity();

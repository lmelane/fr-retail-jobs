CREATE TABLE "MaintenancePlan" (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "revision" TEXT NOT NULL,
  "body" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MaintenancePlan_kind_createdAt_idx" ON "MaintenancePlan"("kind", "createdAt");
CREATE FUNCTION reject_maintenance_plan_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'MaintenancePlan is immutable; create a new plan';
END;
$$;
CREATE TRIGGER maintenance_plan_immutable BEFORE UPDATE OR DELETE ON "MaintenancePlan"
FOR EACH ROW EXECUTE FUNCTION reject_maintenance_plan_mutation();

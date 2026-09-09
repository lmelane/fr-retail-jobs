CREATE TABLE "PipelineRun" (
 "id" TEXT PRIMARY KEY, "command" TEXT NOT NULL, "revision" TEXT,
 "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "finishedAt" TIMESTAMP(3), "status" TEXT NOT NULL DEFAULT 'RUNNING', "metrics" JSONB
);
CREATE INDEX "PipelineRun_startedAt_idx" ON "PipelineRun"("startedAt");
CREATE INDEX "PipelineRun_status_startedAt_idx" ON "PipelineRun"("status","startedAt");
CREATE TABLE "PipelineEvent" (
 "id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL REFERENCES "PipelineRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "level" TEXT NOT NULL, "event" TEXT NOT NULL,
 "sourceKey" TEXT, "connectorId" TEXT, "jobId" TEXT, "fingerprint" TEXT NOT NULL, "payload" JSONB NOT NULL
);
CREATE INDEX "PipelineEvent_runId_sourceKey_at_idx" ON "PipelineEvent"("runId","sourceKey","at");
CREATE INDEX "PipelineEvent_runId_event_fingerprint_idx" ON "PipelineEvent"("runId","event","fingerprint");
CREATE INDEX "PipelineEvent_level_at_idx" ON "PipelineEvent"("level","at");
ALTER TABLE "SourceRun" ADD COLUMN "runId" TEXT;
CREATE INDEX "SourceRun_runId_idx" ON "SourceRun"("runId");

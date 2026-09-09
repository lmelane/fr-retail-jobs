-- The latest committed correction is the revision for corrected aggregates.
-- Indexed lookup remains bounded as the append-only ledger grows.
CREATE INDEX "DataCorrection_createdAt_id_idx" ON "DataCorrection"("createdAt", id);

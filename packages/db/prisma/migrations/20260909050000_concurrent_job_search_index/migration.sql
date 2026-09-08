-- Must run outside a transaction; keeps the existing application readable.
CREATE INDEX CONCURRENTLY "Job_searchText_trgm_idx" ON "Job" USING gin ("searchText" gin_trgm_ops) WHERE "isActive";

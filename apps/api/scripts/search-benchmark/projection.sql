-- Search-only projection of a frozen snapshot. These are deliberately NOT a
-- replacement production schema or fabricated native-capture records.
CREATE TABLE "Company" AS
SELECT c->>'id' AS id, c->>'name' AS name, c->>'canonicalKey' AS "canonicalKey",
 c->>'parentGroup' AS "parentGroup", c->>'parentGroupId' AS "parentGroupId",
 c->>'mergedIntoId' AS "mergedIntoId", ARRAY(SELECT jsonb_array_elements_text(c->'sectorCodes')) AS "sectorCodes"
FROM search_snapshot, jsonb_array_elements(payload->'companies') c WHERE payload->>'type'='metadata';
ALTER TABLE "Company" ADD PRIMARY KEY (id);
CREATE TABLE "CompanyAlias" AS
SELECT c->>'id' AS id, c->>'displayName' AS "displayName", c->>'companyId' AS "companyId",
 c->>'reviewId' AS "reviewId", c->>'sourceKey' AS "sourceKey", c->>'normalizedName' AS "normalizedName"
FROM search_snapshot, jsonb_array_elements(payload->'aliases') c WHERE payload->>'type'='metadata';

CREATE TABLE "Job" AS SELECT j->>'id' AS id, j->>'companyId' AS "companyId",
 j->>'title' AS title, j->>'rawTitle' AS "rawTitle", j->>'description' AS description,
 j->>'department' AS department, j->>'countryCode' AS "countryCode", j->>'city' AS city,
 j->>'location' AS location, j->>'adminArea1' AS "adminArea1", j->>'postalCode' AS "postalCode",
 j->>'workplaceType' AS "workplaceType", j->>'language' AS language,
 j->>'employmentTerm' AS "employmentTerm", j->>'workTime' AS "workTime", j->>'programType' AS "programType",
 (j->>'postedAt')::timestamptz AS "postedAt", (j->>'firstSeenAt')::timestamptz AS "firstSeenAt",
 j->>'occupationCode' AS "occupationCode", j->>'jobFunction' AS "jobFunction",
 j->>'occupationStatus' AS "occupationStatus", j->>'seniority' AS seniority,
 TRUE AS "isActive", NULL::text AS "mergedIntoId", ''::text AS "searchText"
FROM search_snapshot s CROSS JOIN LATERAL (SELECT s.payload->'job' AS j) x WHERE s.payload->>'type'='job';
ALTER TABLE "Job" ADD PRIMARY KEY (id);
CREATE INDEX ON "Job" ("countryCode");
CREATE INDEX ON "Job" ("companyId");
CREATE TABLE "JobSource" AS
SELECT p->>'id' AS id, payload->'job'->>'id' AS "jobId", p->>'sourceKey' AS "sourceKey",
 (p->>'expiresAt')::timestamptz AS "expiresAt", TRUE AS "isActive"
FROM search_snapshot, jsonb_array_elements(payload->'job'->'sources') p WHERE payload->>'type'='job';
CREATE INDEX ON "JobSource" ("jobId");

CREATE TABLE "DirectOffer" AS SELECT j->>'id' AS id, j->>'title' AS title, j->>'company' AS company,
 j->>'description' AS description, j->>'countryCode' AS "countryCode", j->>'city' AS city,
 j->>'location' AS location, j->>'postalCode' AS "postalCode", j->>'workplaceType' AS "workplaceType",
 j->>'language' AS language, j->>'employmentTerm' AS "employmentTerm",
 j->>'workTime' AS "workTime", j->>'programType' AS "programType",
 (j->>'postedAt')::timestamptz AS "postedAt", (j->>'receivedAt')::timestamptz AS "receivedAt",
 (j->>'validThrough')::timestamptz AS "validThrough",
 ARRAY(SELECT jsonb_array_elements_text(j->'sectorCodes')) AS "sectorCodes",
 TRUE AS eligible, concat_ws(' ',j->>'title',j->>'company',j->>'description',j->>'city',j->>'location') AS "searchText"
FROM search_snapshot s CROSS JOIN LATERAL (SELECT s.payload->'job' AS j) x WHERE payload->>'type'='direct';
ALTER TABLE "DirectOffer" ADD PRIMARY KEY (id);

CREATE TABLE "OccupationRelease" AS SELECT
 payload->'occupationRelease'->>'id' AS id, payload->'occupationRelease'->>'contentHash' AS "contentHash",
 payload->'occupationRelease'->'manifest' AS manifest,
 (payload->'occupationRelease'->>'createdAt')::timestamptz AS "createdAt"
FROM search_snapshot WHERE payload->>'type'='metadata';
CREATE TABLE "OccupationState" AS SELECT 'active'::text AS id,
 payload->'occupationRelease'->>'id' AS "releaseId", (payload->>'asOf')::timestamptz AS "updatedAt",
 NULL::timestamptz AS "backfilledAt" FROM search_snapshot WHERE payload->>'type'='metadata';

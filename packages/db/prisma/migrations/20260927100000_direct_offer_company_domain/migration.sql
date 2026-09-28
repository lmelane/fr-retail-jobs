-- D-471: the logo of a Catwalks offer. companyDomain is the bare host the team entered for the Maison in the back-office,
-- else the domain of the registry company the offer is attached to; NULL for an internal mandate (the site shows the
-- Catwalks logo). Read by the API like "Company"."domain" for an aggregated offer. Projected by the 5-minute reader
-- (correspondence version 6), never edited. Additive: one nullable column, no default, no data change, no index, no
-- constraint, no trigger (the search document does not read it).
BEGIN;
SET LOCAL lock_timeout='2s';
ALTER TABLE "DirectOffer" ADD COLUMN "companyDomain" TEXT;
COMMIT;

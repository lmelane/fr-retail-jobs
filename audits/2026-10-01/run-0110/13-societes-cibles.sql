-- Sociétés candidates aux alias de revue d'identité (Cartier, PUMA), et celles que portent déjà les offres et l'alias du 29/09 (lecture seule).
\pset pager off
SELECT c.id, c.name, c."mergedIntoId", c.kind, c."identityReviewId", left(c."fashionjobsUrl", 40) cle,
  (SELECT count(*) FROM "Job" j WHERE j."companyId"=c.id AND j."isActive") actives
FROM "Company" c WHERE c.name IN ('Cartier','PUMA SE','PUMA North America, Inc.') ORDER BY c.name, c."createdAt";
SELECT a."sourceKey", a."normalizedName", c.name, c.id, a."reviewId" FROM "CompanyAlias" a JOIN "Company" c ON c.id=a."companyId"
WHERE a."reviewId" IS NOT NULL AND (a."sourceKey" IN ('richemont','richemont-workday','puma') ) ORDER BY 1,2;
SELECT o."sourceKey", o."rawEmployerName", c.id, c.name, count(DISTINCT o."externalId") offres
FROM "EmployerObservation" o JOIN "Company" c ON c.id=o."canonicalEmployerId"
WHERE o."sourceKey" IN ('richemont','puma') AND o."rawEmployerName" IN ('Cartier','PUMA North America, Inc.') AND o."observedAt" > now() - interval '1 day'
GROUP BY 1,2,3,4;

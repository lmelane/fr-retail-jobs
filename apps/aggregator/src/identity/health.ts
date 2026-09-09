import { Prisma, type PrismaClient } from '@prisma/client';

/** Explicitly separate historical assignments, evidence-backed resolution and missing measurements. */
export async function employerIdentityHealth(tx: Prisma.TransactionClient | PrismaClient) {
  const [totals] = await tx.$queryRaw<Array<{
    companyRecords: number; canonicalRoots: number; mergedRecords: number; rootsWithActiveJobs: number;
    aliases: number; reviewedAliases: number; unclassifiedRoots: number; freeTextParentsWithoutRelation: number;
    jobsOnMergedCompanies: number; pendingObservations: number; legacyObservations: number;
  }>>(Prisma.sql`SELECT
    (SELECT count(*)::int FROM "Company") AS "companyRecords",
    (SELECT count(*)::int FROM "Company" WHERE "mergedIntoId" IS NULL) AS "canonicalRoots",
    (SELECT count(*)::int FROM "Company" WHERE "mergedIntoId" IS NOT NULL) AS "mergedRecords",
    (SELECT count(*)::int FROM "Company" c WHERE c."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM "Job" j WHERE j."companyId"=c.id AND j."isActive")) AS "rootsWithActiveJobs",
    (SELECT count(*)::int FROM "CompanyAlias") AS aliases,
    (SELECT count(*)::int FROM "CompanyAlias" WHERE "reviewId" IS NOT NULL) AS "reviewedAliases",
    (SELECT count(*)::int FROM "Company" WHERE kind='UNKNOWN' AND "mergedIntoId" IS NULL) AS "unclassifiedRoots",
    (SELECT count(*)::int FROM "Company" WHERE "parentGroup" IS NOT NULL AND "parentGroupId" IS NULL AND "mergedIntoId" IS NULL) AS "freeTextParentsWithoutRelation",
    (SELECT count(*)::int FROM "Job" j JOIN "Company" c ON c.id=j."companyId" WHERE c."mergedIntoId" IS NOT NULL) AS "jobsOnMergedCompanies",
    (SELECT count(*)::int FROM "EmployerObservation" WHERE rule='REVIEW_REQUIRED') AS "pendingObservations",
    (SELECT count(*)::int FROM "EmployerObservation" WHERE rule='LEGACY_UNREVIEWED') AS "legacyObservations"`);
  const rules = await tx.employerObservation.groupBy({ by: ['rule', 'labelOrigin'], _count: true });
  return { ...totals, rules, definitions: {
    canonicalRoots: 'Catalogue roots, not a count of independently validated employers.',
    observations: 'Versioned decisions, not distinct jobs. Legacy labels were not archived consistently; no retrospective 100% provenance claim.',
    unclassifiedRoots: 'Existing UNKNOWN classifications remain visible as review work; no classification is inferred from a name.',
  } };
}

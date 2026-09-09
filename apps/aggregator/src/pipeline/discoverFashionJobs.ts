import { PrismaClient } from '@prisma/client';
import { fetchFashionJobsCompanies } from '../connectors/fashionjobs/companyDirectory.js';
import { canonicalCompanyKey } from '../lib/normalize.js';
import { lockEmployerCatalogue, lockSourceWrites } from '../lib/writeLocks.js';
import { canonicalEmployer, recordEmployerObservation } from '../identity/resolve.js';
import { normalizedEmployerName } from '../normalize/employerName.js';
import type { DiscoveredCompany } from '../types.js';
import { log } from '../observability/logger.js';

/** A directory observes labels; only a reviewed decision edits an identity. */
export async function recordDiscoveredEmployer(prisma: PrismaClient, company: DiscoveredCompany) {
  return prisma.$transaction(async tx => {
    await lockEmployerCatalogue(tx);
    await lockSourceWrites(tx, 'fashionjobs-directory', true);
    const row = await tx.company.upsert({
      where: { fashionjobsUrl: company.fashionjobsUrl },
      create: {
        name: company.name, canonicalKey: canonicalCompanyKey(company.name),
        fashionjobsUrl: company.fashionjobsUrl, fashionjobsSlug: company.fashionjobsSlug,
        fashionjobsOfferCount: company.offerCount, lastSeenAt: new Date(),
      },
      update: {
        fashionjobsSlug: company.fashionjobsSlug,
        fashionjobsOfferCount: company.offerCount, lastSeenAt: new Date(),
      },
    });
    const root = await canonicalEmployer(tx, row);
    const normalized = normalizedEmployerName(company.name);
    // A discrepancy remains visible in the immutable observation queue. It is
    // not permission to rename, merge, or deactivate any employer or offer.
    const needsReview = normalized !== normalizedEmployerName(row.name) && normalized !== normalizedEmployerName(root.name);
    await recordEmployerObservation(tx, {
      sourceKey: 'fashionjobs-directory', externalId: company.fashionjobsUrl,
      company: company.name, rawEmployerName: company.name,
      employerLabelOrigin: 'FashionJobs company directory label', sourceTier: 'SPECIALIST_JOBBOARD',
      title: '', url: company.fashionjobsUrl, raw: { ...company },
    }, root.id, {
      company: root, rule: needsReview ? 'REVIEW_REQUIRED' : 'LEGACY_UNREVIEWED',
      rawEmployerName: company.name, normalizedEmployerName: normalized,
    });
    return { id: root.id, needsReview };
  });
}

export async function discoverFashionJobsCompanies(prisma: PrismaClient) {
  const companies = await fetchFashionJobsCompanies();
  let reviewRequired = 0;
  for (const company of companies) {
    if ((await recordDiscoveredEmployer(prisma, company)).needsReview) reviewRequired++;
  }
  await log.info('employer.directory_observed', { companies: companies.length, reviewRequired, evidence: 'EmployerObservation', sourceKey: 'fashionjobs-directory' });
  return companies.length;
}

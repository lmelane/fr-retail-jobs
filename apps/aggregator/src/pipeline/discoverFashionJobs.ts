import { PrismaClient } from '@prisma/client';
import { fetchFashionJobsCompanies } from '../connectors/fashionjobs/companyDirectory.js';
import { canonicalCompanyKey } from '../lib/normalize.js';

export async function discoverFashionJobsCompanies(prisma: PrismaClient) {
  const companies = await fetchFashionJobsCompanies();
  const now = new Date();
  for (const company of companies) {
    await prisma.company.upsert({
      where: { fashionjobsUrl: company.fashionjobsUrl },
      create: {
        name: company.name,
        canonicalKey: canonicalCompanyKey(company.name),
        fashionjobsUrl: company.fashionjobsUrl,
        fashionjobsSlug: company.fashionjobsSlug,
        fashionjobsOfferCount: company.offerCount,
        lastSeenAt: now,
      },
      update: {
        name: company.name,
        canonicalKey: canonicalCompanyKey(company.name),
        fashionjobsSlug: company.fashionjobsSlug,
        fashionjobsOfferCount: company.offerCount,
        lastSeenAt: now,
      },
    });
  }
  return companies.length;
}

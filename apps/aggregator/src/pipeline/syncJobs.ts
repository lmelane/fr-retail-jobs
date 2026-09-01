import { PrismaClient, type Company } from '@prisma/client';
import pLimit from 'p-limit';
import { fetchAtsJobs } from '../ats/index.js';
import { isFranceJob } from '../lib/france.js';
import { jobFingerprint } from '../lib/normalize.js';

async function syncCompany(prisma: PrismaClient, company: Company) {
  if (!company.atsConfig || company.atsType === 'UNKNOWN') return { company: company.name, skipped: true };
  const jobs = await fetchAtsJobs(company.atsType, company.atsConfig as Record<string, unknown>);
  const now = new Date();
  const activeKeys: Array<{ externalId: string }> = [];

  for (const job of jobs) {
    const fingerprint = jobFingerprint({ company: company.name, title: job.title, location: job.location });
    const france = isFranceJob(job.country, job.location);
    await prisma.job.upsert({
      where: { companyId_source_externalId: { companyId: company.id, source: company.atsType, externalId: job.externalId } },
      create: {
        companyId: company.id,
        externalId: job.externalId,
        source: company.atsType,
        title: job.title,
        location: job.location,
        country: job.country,
        isFrance: france,
        contract: job.contract,
        description: job.description,
        url: job.url,
        postedAt: job.postedAt,
        lastSeenAt: now,
        fingerprint,
        raw: job.raw as any,
      },
      update: {
        title: job.title,
        location: job.location,
        country: job.country,
        isFrance: france,
        contract: job.contract,
        description: job.description,
        url: job.url,
        postedAt: job.postedAt,
        lastSeenAt: now,
        isActive: true,
        fingerprint,
        raw: job.raw as any,
      },
    });
    activeKeys.push({ externalId: job.externalId });
  }

  // Only mark stale jobs inactive after a successful full fetch for that company.
  if (activeKeys.length || company.atsType !== 'GENERIC_JSONLD') {
    const activeIds = activeKeys.map((x) => x.externalId);
    await prisma.job.updateMany({
      where: { companyId: company.id, source: company.atsType, externalId: { notIn: activeIds }, isActive: true },
      data: { isActive: false },
    });
  }
  await prisma.company.update({ where: { id: company.id }, data: { lastJobSyncAt: now } });
  return { company: company.name, fetched: jobs.length, france: jobs.filter((j) => isFranceJob(j.country, j.location)).length };
}

export async function syncAllJobs(prisma: PrismaClient) {
  const companies = await prisma.company.findMany({ where: { discoveryStatus: 'FOUND', atsType: { not: 'UNKNOWN' } }, orderBy: { fashionjobsOfferCount: 'desc' } });
  const limit = pLimit(Number(process.env.SYNC_CONCURRENCY ?? 4));
  const results = await Promise.all(companies.map((company) => limit(async () => {
    try { return await syncCompany(prisma, company); }
    catch (error) { return { company: company.name, error: error instanceof Error ? error.message : String(error) }; }
  })));
  return results;
}

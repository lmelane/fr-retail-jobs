import '../test/setup-integration.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { upsertDeduplicated } from '../dedup/upsert.js';
import { resolveCompany } from '../normalize/company.js';
import type { CandidateJob } from '../dedup/match.js';

/**
 * J2 — the collision cases that decide whether 1 323→789 sources can coexist
 * without duplicating openings (validated with Loïc, 2026-09-03).
 *
 * The single real risk at hundreds of sources is the SAME opening arriving
 * through two channels: the Maison's own ATS (flow A) and a jobboard (flow B),
 * or a group feed and the brand's feed. The database must hold ONE canonical
 * job with N JobSources, and the employer's own posting must own the apply URL.
 *
 * Lacoste is the measured real case: discovery found it on DigitalRecruiters
 * (careers.lacoste.com, flow A) AND on WTTJ (flow B).
 */

const prisma = new PrismaClient();

async function wipe() {
  await prisma.jobSource.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.company.deleteMany({});
}

function candidate(overrides: Partial<CandidateJob> & { sourceKey: string }): CandidateJob & { companyId: string } {
  const company = overrides.company ?? 'Lacoste';
  return {
    externalId: 'a-1',
    title: 'Conseiller de vente H/F',
    location: 'Paris',
    description: 'Vendre des polos.',
    url: 'https://careers.lacoste.com/fr/annonce/a-1',
    sourceTier: 'EMPLOYER_DIRECT',
    atsType: 'DIGITALRECRUITERS',
    ...overrides,
    company,
    companyId: resolveCompany(company).companyId,
  } as CandidateJob & { companyId: string };
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('J2 — flow A vs flow B on the same Maison (Lacoste)', () => {
  it('merges the WTTJ copy into the employer posting: 1 job, 2 sources, employer URL kept', async () => {
    const fromEmployer = candidate({ sourceKey: 'lacoste' });
    const fromBoard = candidate({
      sourceKey: 'wttj',
      externalId: 'wttj-77',
      url: 'https://www.welcometothejungle.com/fr/companies/lacoste/jobs/conseiller',
      sourceTier: 'SPECIALIST_JOBBOARD',
      atsType: 'WTTJ',
    });

    const first = await upsertDeduplicated(prisma, fromEmployer);
    const second = await upsertDeduplicated(prisma, fromBoard);

    expect(first.outcome).toBe('CREATED');
    expect(second.outcome).toBe('MERGED');
    expect(second.jobId).toBe(first.jobId);
    expect(second.promoted).toBe(false);

    const jobs = await prisma.job.findMany({ include: { sources: true } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].sources).toHaveLength(2);
    expect(jobs[0].url).toBe('https://careers.lacoste.com/fr/annonce/a-1');
  });

  it('promotes the employer URL when the jobboard copy arrived first', async () => {
    const fromBoard = candidate({
      sourceKey: 'wttj',
      externalId: 'wttj-77',
      url: 'https://www.welcometothejungle.com/fr/companies/lacoste/jobs/conseiller',
      sourceTier: 'SPECIALIST_JOBBOARD',
      atsType: 'WTTJ',
    });
    const fromEmployer = candidate({ sourceKey: 'lacoste' });

    await upsertDeduplicated(prisma, fromBoard);
    const second = await upsertDeduplicated(prisma, fromEmployer);

    expect(second.outcome).toBe('MERGED');
    expect(second.promoted).toBe(true);

    const job = await prisma.job.findFirstOrThrow({ include: { sources: true } });
    expect(job.url).toBe('https://careers.lacoste.com/fr/annonce/a-1');
    expect(job.canonicalTier).toBe('EMPLOYER_DIRECT');
    expect(job.sources).toHaveLength(2);
  });
});

describe('J2 — group feed vs brand feed (LVMH / Louis Vuitton)', () => {
  it('resolves the legal employer name to the brand identity', () => {
    expect(resolveCompany('Louis Vuitton Malletier').companyId).toBe(
      resolveCompany('Louis Vuitton').companyId,
    );
  });

  it('merges a group-feed posting with the brand-feed posting of the same opening', async () => {
    const fromGroup = candidate({
      sourceKey: 'lvmh',
      company: 'Louis Vuitton',
      externalId: 'lvmh-9',
      title: 'Client Advisor',
      url: 'https://www.lvmh.com/join-us/lvmh-9',
      sourceTier: 'GROUP_OFFICIAL',
      atsType: 'LVMH_ALGOLIA',
    });
    const fromBrand = candidate({
      sourceKey: 'louis-vuitton',
      company: 'Louis Vuitton Malletier',
      externalId: 'wd-42',
      title: 'Conseiller de vente H/F',
      url: 'https://jobs.louisvuitton.com/wd-42',
      sourceTier: 'EMPLOYER_DIRECT',
      atsType: 'WORKDAY',
    });

    const first = await upsertDeduplicated(prisma, fromGroup);
    const second = await upsertDeduplicated(prisma, fromBrand);

    // Same city, same company identity, FR/EN titles for one sales role: one
    // opening, and the brand's own posting takes the canonical URL.
    expect(second.jobId).toBe(first.jobId);
    expect(second.promoted).toBe(true);

    const jobs = await prisma.job.findMany({ include: { sources: true } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].url).toBe('https://jobs.louisvuitton.com/wd-42');
    expect(jobs[0].sources.map((s) => s.sourceKey).sort()).toEqual(['louis-vuitton', 'lvmh']);
  });

  it('never fuses two ids of the SAME source, even with near-identical titles (audit D-01)', async () => {
    // The exact production damage: one Workday feed lists three identical
    // retail posts at one boutique under three ids. The old write path fed the
    // guard the candidate's own identity, so it never fired and the three
    // became one displayed offer.
    const first = candidate({
      sourceKey: 'cartier',
      company: 'Cartier',
      externalId: 'wd-1',
      title: 'Sales Associate',
      url: 'https://richemont.wd3.myworkdayjobs.com/wd-1',
      atsType: 'WORKDAY',
    });
    const second = candidate({
      sourceKey: 'cartier',
      company: 'Cartier',
      externalId: 'wd-2',
      title: 'Sales Associate',
      url: 'https://richemont.wd3.myworkdayjobs.com/wd-2',
      atsType: 'WORKDAY',
    });

    await upsertDeduplicated(prisma, first);
    const result = await upsertDeduplicated(prisma, second);

    expect(result.outcome).toBe('CREATED');
    expect(await prisma.job.count()).toBe(2);
  });

  it('still merges the same id arriving again from the same source', async () => {
    const posting = candidate({ sourceKey: 'lacoste', externalId: 'a-1' });
    await upsertDeduplicated(prisma, posting);
    const again = await upsertDeduplicated(prisma, candidate({ sourceKey: 'lacoste', externalId: 'a-1' }));

    expect(again.outcome).not.toBe('CREATED');
    expect(await prisma.job.count()).toBe(1);
  });

  it('keeps two DIFFERENT openings apart even inside one company and city', async () => {
    const sales = candidate({ sourceKey: 'lacoste', externalId: 'a-1' });
    const stock = candidate({
      sourceKey: 'wttj',
      externalId: 'wttj-88',
      title: 'Magasinier — réserve',
      url: 'https://www.welcometothejungle.com/fr/companies/lacoste/jobs/magasinier',
      sourceTier: 'SPECIALIST_JOBBOARD',
      atsType: 'WTTJ',
    });

    await upsertDeduplicated(prisma, sales);
    const second = await upsertDeduplicated(prisma, stock);

    expect(second.outcome).toBe('CREATED');
    expect(await prisma.job.count()).toBe(2);
  });
});

import { upsertDeduplicated } from '../test/publicationPersistenceFixture.js';
import '../test/setup-integration.js';
import { afterAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { storedAmount, publicAmount } from '@catwalks/db/money';

const db = new PrismaClient();
afterAll(() => db.$disconnect());
const candidate = () => {
  const id = `salary-${randomUUID()}`;
  return { company: id, companyId: id, sourceKey: id, sourceTier: 'EMPLOYER_DIRECT' as const,
    externalId: '1', title: 'Client Advisor', url: 'https://example.com/salary', country: 'FR',
    salaryMin: 12.31, salaryMax: 20.8, salaryCurrency: 'EUR', salaryPeriod: 'HOUR',
    raw: { baseSalary: { currency: 'EUR', value: { minValue: 12.31, maxValue: 20.8, unitText: 'HOUR' } } } };
};

describe('source salary precision', () => {
  it('preserves decimal amounts through creation, re-attestation and the numeric API boundary', async () => {
    const input = candidate(); const { jobId } = await upsertDeduplicated(db, input);
    const first = await db.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(first.salaryMin?.toString()).toBe('12.31'); expect(first.salaryMax?.toString()).toBe('20.8');
    expect(publicAmount(first.salaryMin)).toBe(12.31);
    await upsertDeduplicated(db, input);
    const repeated = await db.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(repeated.salaryMin?.toString()).toBe('12.31'); expect(repeated.salaryMax?.toString()).toBe('20.8');
    await upsertDeduplicated(db, { ...input, salaryMax: 20.95, raw: { ...input.raw, baseSalary: { currency: 'EUR', value: { minValue: 12.31, maxValue: 20.95, unitText: 'HOUR' } } } });
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).salaryMax?.toString()).toBe('20.95');
  });

  it('withholds an unrepresentable optional amount while preserving the offer and its observation', async () => {
    const input = candidate(); input.salaryMin = 0.1234567; input.raw.baseSalary.value.minValue = input.salaryMin;
    const { jobId } = await upsertDeduplicated(db, input);
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).salaryMin).toBeNull();
    const source = await db.jobSource.findFirstOrThrow({ where: { sourceKey: input.sourceKey } });
    expect(source.sourceFacts).toMatchObject({ salary: { status: 'INVALID', value: null } });
    expect(await db.sourceObservation.count({ where: { sourceKey: input.sourceKey } })).toBe(1);
  });

  it('rejects unsupported precision and exposes only amounts that round-trip exactly as JSON numbers', () => {
    expect(storedAmount('12.310000')?.toString()).toBe('12.31');
    for (const value of ['-1', 'NaN', 'Infinity', '0.0000001', '1000000000000000000']) expect(() => storedAmount(value)).toThrow('without loss');
    expect(publicAmount(new Prisma.Decimal('999999999999999999.999999'))).toBeNull();
    expect(publicAmount(null)).toBeNull();
  });
});

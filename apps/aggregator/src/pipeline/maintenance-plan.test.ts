import '../test/setup-integration.js';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { evidenceHash } from '../lib/evidenceHash.js';
import { recordDataCorrection, storeMaintenancePlan } from '../lib/maintenancePlan.js';

const db = new PrismaClient();
afterAll(() => db.$disconnect());
const witness = () => ({ nonce: randomUUID(), coordinates: [48.775130000000004, 0.30000000000000004], label: 'Été / 東京 / "RAW"' });
const plan = () => { const body = witness(); return { id: evidenceHash(body), kind: 'NUMERIC_REPLAY_WITNESS', version: 1, revision: 'test-revision', body }; };

describe('lossless maintenance evidence persistence', () => {
  it('keeps finite JSON numbers and the reviewed hash through storage and replay', async () => {
    const input = plan();
    const first = await storeMaintenancePlan(db, input);
    expect(first.body).toEqual(input.body);
    expect(evidenceHash(first.body)).toBe(input.id);
    expect(await storeMaintenancePlan(db, input)).toEqual(first);
  });

  it('accepts concurrent identical inserts without changing the stored body', async () => {
    const input = plan();
    const [a, b] = await Promise.all([storeMaintenancePlan(db, input), storeMaintenancePlan(db, input)]);
    expect(a).toEqual(b);
    expect(a.body).toEqual(input.body);
  });

  it.each(['body', 'kind', 'version', 'revision'] as const)('rejects an existing plan with changed %s', async key => {
    const input = plan();
    await storeMaintenancePlan(db, input);
    const changed = { ...input, [key]: key === 'body' ? witness() : key === 'version' ? 2 : 'changed' };
    await expect(storeMaintenancePlan(db, changed)).rejects.toThrow('Stored maintenance plan differs');
    expect((await db.maintenancePlan.findUniqueOrThrow({ where: { id: input.id } })).body).toEqual(input.body);
  });

  it('keeps the same numbers in the immutable correction journal', async () => {
    const input = witness(), id = randomUUID();
    await recordDataCorrection(db, { id, batchId: id, planHash: evidenceHash(input), commitHash: 'test-revision',
      finding: 'NUMERIC_REPLAY_WITNESS', entityType: 'TestWitness', entityId: id, before: input, after: input, evidence: input });
    const saved = await db.dataCorrection.findUniqueOrThrow({ where: { id } });
    expect(saved).toMatchObject({ before: input, after: input, evidence: input });
    await expect(db.dataCorrection.update({ where: { id }, data: { after: {} } })).rejects.toThrow('append-only');
  });
});

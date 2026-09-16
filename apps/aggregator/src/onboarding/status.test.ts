import { afterEach, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import * as identity from '../connectors/sourceIdentity.js';
import { sourceStatus } from './status.js';

afterEach(() => vi.restoreAllMocks());
it('does not disguise an unavailable database as missing identity evidence', async () => {
  const failure = new Error('Database unavailable');
  vi.spyOn(identity, 'readIdentitySource').mockResolvedValue({ key: 'test' } as never);
  const tx = { $executeRaw: vi.fn(),
    sourceIdentityReview: { findFirst: vi.fn().mockResolvedValue(null).mockRejectedValueOnce(failure) },
    sourceValidation: { findFirst: vi.fn().mockResolvedValue(null) },
    captureBatch: { findFirst: vi.fn().mockResolvedValue(null) } };
  const db = { $transaction: (fn: (client: unknown) => Promise<unknown>) => fn(tx) };
  await expect(sourceStatus(db as unknown as PrismaClient, 'test')).rejects.toBe(failure);
});

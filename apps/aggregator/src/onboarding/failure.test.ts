import { expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { sourceFailure } from './failure.js';
import { SourcePromotionGateError } from '../connectors/sourceStore.js';

const secret = 'sensitive-unlabelled-dossier-value';
it.each([
  new Error(`Request failed: https://${secret}@example.com`),
  new SyntaxError(`Invalid JSON near ${secret}`),
  new Prisma.PrismaClientKnownRequestError(`Query with ${secret}`, { code: 'P2002', clientVersion: 'test', meta: { config: secret } }),
  new SourcePromotionGateError('ACCESS_DENIED', `Private access note ${secret}`),
])('does not expose exception bodies or database parameters %#', error => {
  expect(JSON.stringify(sourceFailure(error))).not.toContain(secret);
});
it('retains an actionable gate code', () => {
  expect(sourceFailure(new SourcePromotionGateError('REVISION_MISMATCH', secret)).code).toBe('REVISION_MISMATCH');
});

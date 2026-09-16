import type { PrismaClient, RawCapture } from '@prisma/client';
import type { ObjectStore } from '../retention/objectStore.js';
import { auditUrl } from './context.js';
import { readRawBlob } from './store.js';
import { REQUEST_DATA_MAX_BYTES, logicalRequestFingerprint, validateRequestData, type RequestData } from './requestData.js';

/** Historical absence stays unknown. Never backfill from the current collector identity. */
export async function readRequestData(db: PrismaClient, row: Pick<RawCapture, 'requestDataHash' | 'requestHash' | 'requestUrl' | 'method' | 'format' | 'status'>, store?: ObjectStore): Promise<RequestData | null> {
  if (!row.requestDataHash) return null;
  const bytes = await readRawBlob(db, row.requestDataHash, store);
  if (bytes.length > REQUEST_DATA_MAX_BYTES) throw new Error('Native request envelope exceeds its byte budget');
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  validateRequestData(value);
  if (logicalRequestFingerprint(value.logical) !== row.requestHash || auditUrl(value.logical.url) !== row.requestUrl ||
    value.logical.method !== row.method || value.logical.format !== row.format ||
    row.status !== null && value.hops.length > 0 && value.hops.at(-1)!.status !== row.status) throw new Error('Native request envelope differs from its capture');
  return value;
}

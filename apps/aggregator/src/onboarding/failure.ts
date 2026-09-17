import { Prisma } from '@prisma/client';
import { SourceIdentityGateError } from '../connectors/sourceIdentity.js';
import { SourceValidationGateError } from '../connectors/sourceCertification.js';
import { SourcePromotionGateError } from '../connectors/sourceStore.js';
import { SourceAccessGateError } from '../connectors/accessScope.js';

/** Exceptions can contain database parameters, input excerpts or credentialled
 * request URLs. Only known diagnostic codes cross the command boundary. */
export function sourceFailure(error: unknown): { error: string; code: string } {
  if (error instanceof SourceIdentityGateError || error instanceof SourceValidationGateError || error instanceof SourcePromotionGateError || error instanceof SourceAccessGateError) {
    return { error: 'Source evidence gate refused the operation', code: error.code };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) return { error: 'Source database operation failed', code: error.code };
  if (error instanceof SyntaxError) return { error: 'Input JSON is invalid', code: 'INVALID_JSON' };
  if (error && typeof error === 'object' && 'code' in error && ['ENOENT', 'EACCES', 'ELOOP'].includes(String(error.code))) {
    return { error: 'Input or output file is unavailable', code: String(error.code) };
  }
  return { error: 'Source operation failed; inspect the dossier and recorded evidence with profile and status', code: 'SOURCE_OPERATION_FAILED' };
}

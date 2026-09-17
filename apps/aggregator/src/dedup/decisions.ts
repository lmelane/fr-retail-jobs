import type { JobSource, Prisma } from '@prisma/client';
import { evidenceHash } from '../lib/evidenceHash.js';
import { publicationIdentityProof, provenPublicationGroup } from './match.js';
import { POSTING_IDENTITY_VERSION } from './postingIdentity.js';
import { nativeIdentityScalar } from '../identity/postingRepair.js';

function snapshot(source: JobSource) {
  return { id: source.id, sourceKey: source.sourceKey, externalId: source.externalId, url: source.url,
    rawHash: evidenceHash(source.raw), lastSeenAt: source.lastSeenAt.toISOString(),
    captureBatchId: source.captureBatchId, captureOutputId: source.captureOutputId };
}

/** Persist the identity evidence in the same transaction as group membership. */
export async function recordPublicationAttachment(tx: Prisma.TransactionClient, subject: JobSource,
  peers: readonly JobSource[], fromJobId: string | null, toJobId: string) {
  if (!peers.length || !provenPublicationGroup([subject, ...peers])) throw new Error('Publication group requires pairwise identity evidence');
  await tx.publicationIdentityDecision.create({ data: { sourceId: subject.id, fromJobId, toJobId,
    action: fromJobId ? 'MOVED' : 'ATTACHED', readerVersion: POSTING_IDENTITY_VERSION,
    evidence: { subject: snapshot(subject), peers: peers.map(peer => ({ ...snapshot(peer),
      proof: publicationIdentityProof(subject, peer) })) } as Prisma.InputJsonValue,
  } });
}

/** A reviewed RAW equivalence survives a refresh only while every native witness
 * still agrees. An old approval cannot authorize changed identity evidence. */
export async function reviewedPublicationGroup(tx: Prisma.TransactionClient, jobId: string,
  publications: readonly { id: string; raw?: unknown }[]): Promise<boolean> {
  const latest = await tx.publicationIdentityDecision.findFirst({ where: { toJobId: jobId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const evidence = latest?.evidence as Record<string, any> | undefined;
  if (latest?.action !== 'MOVED' || evidence?.rule !== 'REVIEWED_RAW_IDENTITY' ||
    typeof evidence.issuer !== 'string' || typeof evidence.postingId !== 'string' || !Array.isArray(evidence.witnesses) ||
    evidence.witnesses.length !== publications.length || new Set(evidence.witnesses.map(w => w?.sourceId)).size !== publications.length) return false;
  return publications.every(publication => {
    const witness = evidence.witnesses.find((item: { sourceId?: string } | null) => item?.sourceId === publication.id);
    return witness && Array.isArray(witness.issuerPath) && Array.isArray(witness.postingIdPath) &&
      witness.issuerPath.every((item: unknown) => typeof item === 'string') && witness.postingIdPath.every((item: unknown) => typeof item === 'string') &&
      nativeIdentityScalar(publication.raw, witness.issuerPath) === evidence.issuer &&
      nativeIdentityScalar(publication.raw, witness.postingIdPath) === evidence.postingId;
  });
}

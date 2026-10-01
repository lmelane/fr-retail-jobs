/** Lecture seule : la règle d'identité iCIMS appliquée à la sortie scellée de l'offre urbn-hub 30772 (RUN du 01/10/2026). */
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../../apps/aggregator/src/capture/store.js';
import { icimsDetailMatchesListing } from '../../../apps/aggregator/src/identity/icims.js';

const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const [source] = await p.$queryRawUnsafe<{ config: Record<string, unknown> }[]>(
  `SELECT r.payload->'config' AS config FROM "Source" s JOIN "SourceRevision" r ON r.id = s."currentRevisionId" WHERE s.key = 'urbn-hub'`);
const row = await p.sourceExtraction.findFirstOrThrow({ where: { batchId: 'c96b0e8b-a355-4fa7-9832-6f090aedd245', externalId: '30772' } });
const job = JSON.parse((await readRawBlob(p, row.outputHash)).toString('utf8'));
console.log(JSON.stringify({ heldAtCapture: job.publicationHold, listing: job.url, declared: job.raw.postingEvidence.jobPosting.url,
  matchesWithThisCode: icimsDetailMatchesListing(job, source.config) }));
await p.$disconnect();

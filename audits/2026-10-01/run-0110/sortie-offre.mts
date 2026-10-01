/** Lecture seule : la sortie d'adaptateur scellée d'une offre dans une capture. Usage : tsx sortie-offre.mts <captureBatchId> <externalId> */
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../../apps/aggregator/src/capture/store.js';

const [batchId, externalId] = process.argv.slice(2);
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const row = await p.sourceExtraction.findFirstOrThrow({ where: { batchId, externalId } });
const job = JSON.parse((await readRawBlob(p, row.outputHash)).toString('utf8'));
const { description: _d, ...rest } = job;
const raw = rest.raw ?? {};
if (raw.postingEvidence?.jobPosting?.description) raw.postingEvidence.jobPosting.description = `[${String(raw.postingEvidence.jobPosting.description).length} car.]`;
console.log(JSON.stringify(rest, null, 1).slice(0, 6000));
await p.$disconnect();

/**
 * Lecture seule : ce que le résolveur d'identité d'employeur décide AUJOURD'HUI pour une offre d'une capture du RUN,
 * sur l'état présent de la base (la fiche partagée a pu changer depuis la collecte). `resolveEmployer` ne fait que
 * lire ; il tourne ici sur le client, hors de toute transaction d'écriture.
 * Usage : tsx resoudre-employeur.mts <captureBatchId> <sourceKey> <externalId>
 */
import { PrismaClient, type AtsType } from '@prisma/client';
import { readRawBlob } from '../../../apps/aggregator/src/capture/store.js';
import { toCandidate, KIND_TO_ATS } from '../../../apps/aggregator/src/pipeline/ingest.js';
import { resolveEmployer } from '../../../apps/aggregator/src/identity/resolve.js';

const [batchId, sourceKey, externalId] = process.argv.slice(2);
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const source = await p.source.findUniqueOrThrow({ where: { key: sourceKey } });
const row = await p.sourceExtraction.findFirstOrThrow({ where: { batchId, externalId } });
const job = JSON.parse((await readRawBlob(p, row.outputHash)).toString('utf8'));
const sourceDef = { key: source.key, company: source.maison.split('(')[0].trim(), tier: source.tier as never, careersDomain: source.careersDomain || undefined };
const candidate = toCandidate(job, sourceDef, job.company || sourceDef.company, KIND_TO_ATS[source.kind] as AtsType);
try {
  const resolution = await resolveEmployer(p as never, candidate);
  console.log(sourceKey, externalId, JSON.stringify({ raw: resolution.rawEmployerName, rule: resolution.rule, company: resolution.company?.name ?? null }));
} catch (error) {
  console.log(sourceKey, externalId, 'REFUS :', (error as Error).message);
}
await p.$disconnect();

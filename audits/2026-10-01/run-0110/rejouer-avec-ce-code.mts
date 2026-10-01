/**
 * Lecture seule : rejoue HORS RÉSEAU une capture du RUN avec le code de cette copie, et dit ce que l'énumération
 * rendrait. Un rejeu ne peut servir que les requêtes capturées : un code qui en émet d'autres (seconde passe) échoue
 * sur `OfflineReplayError`, ce qui est attendu. Usage : tsx rejouer-avec-ce-code.mts <captureBatchId>…
 */
import { PrismaClient } from '@prisma/client';
import { replayExtraction } from '../../../apps/aggregator/src/capture/batch.js';
import { fetchAtsJobs } from '../../../apps/aggregator/src/ats/index.js';
import { KIND_TO_ATS } from '../../../apps/aggregator/src/pipeline/ingest.js';
import { captureConfig } from '../../../apps/aggregator/src/capture/config.js';
import { effectiveSourceConfig } from '../../../apps/aggregator/src/connectors/sourceConfig.js';
import { readEnumeration } from '../../../apps/aggregator/src/pipeline/enumerationReading.js';

const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
for (const id of process.argv.slice(2)) {
  const [b] = await p.$queryRawUnsafe<{ sourceKey: string; payload: string }[]>(
    `SELECT b."sourceKey", r.payload::text AS payload FROM "CaptureBatch" b JOIN "SourceRevision" r ON r.id = b."sourceRevisionId" WHERE b.id = $1`, id);
  const rev = JSON.parse(b.payload);
  try {
    const r = await replayExtraction(p, id, () => fetchAtsJobs(KIND_TO_ATS[rev.kind] as never, captureConfig(effectiveSourceConfig(rev.config))));
    console.log(b.sourceKey, JSON.stringify({ jobs: r.jobs.length, declaredTotal: r.declaredTotal, complete: r.complete, truncated: r.truncated,
      termination: r.enumeration?.termination, issues: r.enumeration?.issues, rejected: r.rejectedRows?.map(row => row.reason), reading: readEnumeration(r).enumerationReading }));
  } catch (error) { console.log(b.sourceKey, 'REJEU IMPOSSIBLE :', (error as Error).name, (error as Error).message.slice(0, 160)); }
}
await p.$disconnect();

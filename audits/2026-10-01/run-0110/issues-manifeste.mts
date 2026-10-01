/** Lecture seule : les `enumeration.issues` scellés dans le manifeste d'une capture (RUN du 01/10/2026). Usage : tsx issues-manifeste.mts <captureBatchId>… */
import { PrismaClient } from '@prisma/client';
import { readExtractionManifest } from '../../../apps/aggregator/src/capture/manifest.js';

const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
for (const id of process.argv.slice(2)) {
  const m = await readExtractionManifest(p, id);
  const meta = m.metadata as { enumeration?: { issues?: string[]; termination?: string; blockers?: unknown }; declaredTotal?: number; complete?: boolean; truncated?: boolean };
  console.log(id, JSON.stringify({ declaredTotal: meta.declaredTotal, complete: meta.complete, truncated: meta.truncated, termination: meta.enumeration?.termination, blockers: meta.enumeration?.blockers, issues: meta.enumeration?.issues }));
}
await p.$disconnect();

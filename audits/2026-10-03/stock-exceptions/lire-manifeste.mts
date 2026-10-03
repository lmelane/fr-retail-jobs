/**
 * L'énumération scellée dans le manifeste d'une capture (CaptureOutcome.manifest), sans les preuves page par page —
 * lecture seule.
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx audits/2026-10-03/stock-exceptions/lire-manifeste.mts --batch=<id> [--pages] [--brut]
 */
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../../apps/aggregator/src/capture/store.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const batchId = arg('batch');
if (!batchId) { console.error('usage: --batch='); process.exit(2); }
const prisma = new PrismaClient({ log: [] });
try {
  const outcome = await prisma.captureOutcome.findUnique({ where: { batchId } });
  if (!outcome?.manifestHash) { console.log(JSON.stringify({ batchId, outcome })); process.exit(0); }
  const manifest = JSON.parse((await readRawBlob(prisma, outcome.manifestHash)).toString('utf8'));
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.length > 40 ? [`(${value.length} éléments)`, ...value.slice(0, 3).map(strip)] : value.map(strip);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) =>
      [k, k === 'pageEvidence' ? (process.argv.includes('--pages') ? v : `(${(v as unknown[]).length} pages)`) : strip(v)]));
    return value;
  };
  // --brut : le manifeste entier, tel que scellé.
  console.log(JSON.stringify({ batchId, status: outcome.status, extracted: outcome.extractedCount, manifest: process.argv.includes('--brut') ? manifest : strip(manifest) }, null, 1));
} finally { await prisma.$disconnect(); }

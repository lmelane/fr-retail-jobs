/**
 * LES ANNONCES RETENUES FAUTE D'EMPLOYEUR, telles que l'ingestion les a scellées — lecture seule.
 *
 *   CATWALKS_DB_ACCESS=… python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     audits/2026-10-03/stock-exceptions/workday-marques/extraire-retenues.mts --run=<runId> --out=<dossier hors dépôt> [--sources=a,b]
 *   … extraire-retenues.mts --batch=<id de CaptureBatch> --out=<dossier> --sans-employeur   (lot de qualification, sans rapport)
 *
 * Mode RUN : pour chaque source, le lot d'INGESTION du RUN (celui qui porte `SourceIngestionCompletion`) ; son rapport
 * scellé nomme le devenir de chaque sortie (`OutputFate`). Seules les sorties retenues `WORKDAY_EMPLOYER_ABSENT_IN_DETAIL`
 * sont relues (`SourceExtraction` → `RawBlob`), sans réseau ni rejeu.
 * Mode lot (`--sans-employeur`) : un lot sans rapport de fin (une capture de qualification) ; toutes ses sorties sont
 * relues et seules celles qui ne nomment aucun employeur (ni `company` ni `employerEvidence`, sans retenue) sont gardées.
 *
 * Écrit dans `--out` : `<source>.retenues.jsonl` (sorties complètes). Ces fichiers contiennent des corps tiers : ils
 * restent hors dépôt. Rien n'est écrit en base.
 */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { readRawBlob } from '../../../../apps/aggregator/src/capture/store.js';
import type { CompletionReport } from '../../../../apps/aggregator/src/capture/completion.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const run = arg('run');
const batchArg = arg('batch');
const out = arg('out');
const HOLD = 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL';
if ((!run && !batchArg) || !out) { console.error('usage: extraire-retenues.mts (--run=<runId> | --batch=<id> --sans-employeur) --out=<dossier>'); process.exit(2); }
mkdirSync(out, { recursive: true });

const prisma = new PrismaClient({ log: [] });
const limit = pLimit(12);
const lire = (hash: string) => limit(async () => JSON.parse((await readRawBlob(prisma, hash)).toString('utf8')) as Record<string, unknown>);
try {
  const bilan: Record<string, { lot: string; retenues: number }> = {};
  if (batchArg) {
    const lot = await prisma.captureBatch.findUniqueOrThrow({ where: { id: batchArg }, select: { sourceKey: true } });
    const sorties = await prisma.sourceExtraction.findMany({ where: { batchId: batchArg }, orderBy: { ordinal: 'asc' }, select: { outputHash: true } });
    const jobs = await Promise.all(sorties.map((s) => lire(s.outputHash)));
    const sans = jobs.filter((j) => !j.publicationHold && !(typeof j.company === 'string' && j.company.trim()) && !j.employerEvidence);
    writeFileSync(join(out, `${lot.sourceKey}.sans-employeur.jsonl`), sans.map((j) => JSON.stringify(j)).join('\n') + '\n');
    console.log(JSON.stringify({ lot: batchArg, source: lot.sourceKey, sorties: jobs.length, sansEmployeur: sans.length,
      retenues: jobs.filter((j) => j.publicationHold).length }, null, 1));
  } else {
    const filtre = arg('sources')?.split(',').filter(Boolean);
    const lots = await prisma.$queryRawUnsafe<Array<{ sourceKey: string; id: string; reportHash: string }>>(
      `SELECT b."sourceKey", b.id, c."reportHash" FROM "CaptureBatch" b JOIN "SourceIngestionCompletion" c ON c."batchId" = b.id
        WHERE b."runId" = $1 AND b.purpose = 'JOBS' ${filtre ? 'AND b."sourceKey" = ANY($2::text[])' : ''} ORDER BY b."sourceKey"`,
      ...(filtre ? [run, filtre] : [run]));
    for (const lot of lots) {
      const rapport = await lire(lot.reportHash) as unknown as CompletionReport;
      const ordinaux = rapport.fates.filter((f) => f.disposition === 'HELD' && f.reason === HOLD).map((f) => f.ordinal);
      if (!ordinaux.length) continue;
      const sorties = await prisma.sourceExtraction.findMany({ where: { batchId: lot.id, ordinal: { in: ordinaux } }, orderBy: { ordinal: 'asc' }, select: { outputHash: true } });
      const jobs = await Promise.all(sorties.map((s) => lire(s.outputHash)));
      const retenues = jobs.filter((j) => j.publicationHold === HOLD);
      writeFileSync(join(out, `${lot.sourceKey}.retenues.jsonl`), retenues.map((j) => JSON.stringify(j)).join('\n') + '\n');
      bilan[lot.sourceKey] = { lot: lot.id, retenues: retenues.length };
    }
    console.log(JSON.stringify({ run, hold: HOLD, sources: bilan, total: Object.values(bilan).reduce((n, b) => n + b.retenues, 0) }, null, 1));
  }
} finally {
  await prisma.$disconnect();
}

/**
 * D-522 §6 : les offres de tapestry lues HORS de toute valeur de la facette Brand au RUN du 02/10 (capture 5a479340),
 * rejouées hors réseau avec le lecteur de ce worktree. Lecture seule.
 *   CATWALKS_DB_ACCESS=<accès> python3 apps/aggregator/scripts/ops/db.py readonly \
 *     npx tsx audits/2026-10-03/stock-exceptions/tapestry/hors-partition.mts > audits/2026-10-03/stock-exceptions/tapestry/hors-partition.out
 */
import { PrismaClient } from '@prisma/client';
import { replayExtraction } from '../../../../apps/aggregator/src/capture/batch.js';
import { fetchAtsJobs } from '../../../../apps/aggregator/src/ats/index.js';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL } } });
const [src] = await prisma.$queryRawUnsafe<Array<{ config: Record<string, unknown> }>>(`SELECT config FROM "Source" WHERE key = 'tapestry'`);
const r = await replayExtraction(prisma as never, '5a479340-4b14-4cf8-9aa9-4a5094a683e9', () => fetchAtsJobs('WORKDAY', src!.config));
const outside = r.jobs.filter((j) => !(j.raw as { facet?: unknown }).facet);
console.log(`hors partition : ${outside.length} sur ${r.jobs.length}`);
for (const j of outside) {
  const raw = j.raw as { detail?: { jobPostingInfo?: { logoImage?: { alt?: string } }; hiringOrganization?: { name?: string } } };
  console.log([j.externalId, j.title, j.location, j.company ?? '-', raw.detail?.hiringOrganization?.name ?? '-', raw.detail?.jobPostingInfo?.logoImage?.alt ?? '-'].join(' | '));
}
await prisma.$disconnect();

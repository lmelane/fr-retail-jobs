/**
 * D-522 §6 (lecture métier du 03/10, HIGH) : exécute en LECTURE SEULE la requête réelle du périmètre d'absence
 * (`outsideScopeOf`) sur wttj-sector, avec le périmètre que rendrait une preuve où Hermès serait sortie du balayage.
 *   CATWALKS_DB_ACCESS=<accès> python3 apps/aggregator/scripts/ops/db.py readonly \
 *     npx tsx audits/2026-10-03/stock-exceptions/wttj-sector/perimetre-absence.mts
 */
import { PrismaClient } from '@prisma/client';
import { outsideScopeOf } from '../../../../apps/aggregator/src/pipeline/refreshEvidence.js';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL } } });
const slugs = (await prisma.$queryRaw<{ slug: string; n: bigint }[]>`SELECT raw #>> '{organization,slug}' AS slug, count(*) n FROM "JobSource"
  WHERE "sourceKey" = 'wttj-sector' AND "isActive" GROUP BY 1 ORDER BY 2 DESC`);
const all = slugs.map((s) => s.slug);
const total = slugs.reduce((sum, s) => sum + Number(s.n), 0);
const every = await outsideScopeOf(prisma, 'wttj-sector', { absenceScope: { rawPath: ['organization', 'slug'], proven: all } });
const withoutHermes = await outsideScopeOf(prisma, 'wttj-sector', { absenceScope: { rawPath: ['organization', 'slug'], proven: all.filter((s) => s !== 'hermes') } });
console.log(JSON.stringify({ representationsActives: total, organisations: all.length, hermes: Number(slugs.find((s) => s.slug === 'hermes')?.n ?? 0),
  horsPerimetreToutesProuvees: every.size, horsPerimetreHermesSortie: withoutHermes.size }));
await prisma.$disconnect();

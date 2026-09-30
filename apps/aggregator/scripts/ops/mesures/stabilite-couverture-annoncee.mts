/**
 * LA PART PUBLIÉE DU TOTAL ANNONCÉ, D'UN RUN À L'AUTRE — lecture seule. Mesure la tolérance de D-484 §2.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/mesures/stabilite-couverture-annoncee.mts [--depuis=2026-09-20]
 *
 * D-484 §2 : une chute de plus de 50 % ne bloque plus le RUN quand le total annoncé par l'éditeur baisse « dans la
 * même proportion ». Les deux proportions sont `offres / offres de la veille` et `annoncé / annoncé de la veille` ;
 * leur rapport est celui des parts publiées du total annoncé, `(offres / annoncé) / (offres de la veille / annoncé de
 * la veille)`. Ce programme en rend la distribution sur les couples de runs CONSÉCUTIFS d'une même source, tous deux
 * à énumération prouvée, avec un total annoncé et des offres : c'est le bruit ordinaire d'une source saine, contre
 * lequel la tolérance se fixe. Il rend aussi, parmi ces runs, la part où toutes les offres annoncées ont été lues
 * (`fetched = declaredTotal`). Colonnes lues : `SourceRun.jobs`, `declaredTotal`, `fetched`, `complete`. N'écrit rien.
 */
import { PrismaClient } from '@prisma/client';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const depuis = arg('depuis') ?? '2026-09-20';
const prisma = new PrismaClient({ log: [] });
try {
  const rows = await prisma.$queryRawUnsafe<{ sourceKey: string; ranAt: Date; jobs: number; declaredTotal: number; fetched: number | null;
    prevJobs: number; prevDeclared: number }[]>(`
    SELECT r."sourceKey", r."ranAt", r.jobs, r."declaredTotal", r.fetched, p.jobs AS "prevJobs", p."declaredTotal" AS "prevDeclared"
      FROM "SourceRun" r
      JOIN LATERAL (SELECT x.jobs, x."declaredTotal", x.complete FROM "SourceRun" x
                     WHERE x."sourceKey" = r."sourceKey" AND x."ranAt" < r."ranAt" ORDER BY x."ranAt" DESC LIMIT 1) p ON true
     WHERE r."ranAt" >= $1::timestamp AND r.complete = true AND r."declaredTotal" > 0 AND r.jobs > 0
       AND p.complete = true AND p."declaredTotal" > 0 AND p.jobs > 0`, depuis);
  const ecarts = rows.map((row) => ({ ...row, ecart: Math.abs((row.jobs / row.declaredTotal) / (row.prevJobs / row.prevDeclared) - 1) }))
    .sort((a, b) => a.ecart - b.ecart);
  const quantile = (q: number) => ecarts.length ? ecarts[Math.min(ecarts.length - 1, Math.floor(q * ecarts.length))].ecart : null;
  const sous = (seuil: number) => ecarts.filter((row) => row.ecart <= seuil).length;
  const complets = await prisma.$queryRawUnsafe<{ n: bigint; lues: bigint }[]>(`
    SELECT count(*) AS n, count(*) FILTER (WHERE fetched = "declaredTotal") AS lues FROM "SourceRun"
     WHERE "ranAt" >= $1::timestamp AND complete = true AND "declaredTotal" > 0`, depuis);
  console.log(JSON.stringify({
    depuis, couples: ecarts.length, sources: new Set(ecarts.map((row) => row.sourceKey)).size,
    quantiles: { p50: quantile(0.5), p90: quantile(0.9), p95: quantile(0.95), p99: quantile(0.99), max: ecarts.at(-1)?.ecart ?? null },
    sousLeSeuil: { '1 %': sous(0.01), '2 %': sous(0.02), '5 %': sous(0.05), '10 %': sous(0.1) },
    lesPlusGrandsEcarts: ecarts.slice(-12).reverse().map((row) => ({ source: row.sourceKey, a: row.ranAt.toISOString().slice(0, 16),
      offres: `${row.prevJobs} → ${row.jobs}`, annonce: `${row.prevDeclared} → ${row.declaredTotal}`, ecart: Math.round(row.ecart * 10000) / 10000 })),
    // La zone où se fixe la tolérance : les écarts entre 1 % et 10 %, un par un.
    entreUnEtDixPourCent: ecarts.filter((row) => row.ecart > 0.01 && row.ecart <= 0.1).map((row) => ({ source: row.sourceKey,
      a: row.ranAt.toISOString().slice(0, 16), offres: `${row.prevJobs} → ${row.jobs}`, annonce: `${row.prevDeclared} → ${row.declaredTotal}`,
      lues: row.fetched, ecart: Math.round(row.ecart * 10000) / 10000 })),
    runsProuves: { total: Number(complets[0].n), toutLu: Number(complets[0].lues) },
  }, null, 1));
} finally {
  await prisma.$disconnect();
}

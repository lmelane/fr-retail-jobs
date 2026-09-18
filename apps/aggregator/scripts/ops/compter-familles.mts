/**
 * COMBIEN DE SOURCES PAR FAMILLE ET PAR STATUT — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/compter-familles.mts
 *
 * Sert à dimensionner une correction : un défaut mesuré sur une source ne dit rien de sa portée
 * tant qu'on n'a pas compté combien de sources partagent la même famille.
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

type Ligne = { kind: string; actives: number; total: number };
const rows = await prisma.$queryRawUnsafe<Ligne[]>(`
  SELECT kind,
         count(*) FILTER (WHERE status = 'ACTIVE')::int AS actives,
         count(*)::int AS total
    FROM "Source" GROUP BY kind ORDER BY actives DESC, kind`);

console.log('\nfamille                        ACTIVE   total');
for (const r of rows) {
  console.log(`   ${r.kind.padEnd(28)} ${String(r.actives).padStart(5)}   ${String(r.total).padStart(5)}`);
}
const a = rows.reduce((s, r) => s + r.actives, 0);
const t = rows.reduce((s, r) => s + r.total, 0);
console.log(`   ${'TOTAL'.padEnd(28)} ${String(a).padStart(5)}   ${String(t).padStart(5)}\n`);

await prisma.$disconnect();

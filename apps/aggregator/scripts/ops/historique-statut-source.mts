/**
 * QUAND ET POURQUOI UNE SOURCE A CHANGÉ DE STATUT — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/historique-statut-source.mts [<clé>…]
 *
 * Le registre garde une révision par changement surveillé (`Source_record_revision` : clé, maison,
 * kind, config, careersDomain, jobUrlPattern, tier, tenantKey). Le STATUT n'est pas dans cette
 * liste — un passage ACTIVE → PAUSED ne crée donc pas de révision. On lit alors ce qui reste :
 * `updatedAt`, la note, et les événements de cycle de vie s'il en existe une table.
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const q = <T,>(s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(s, ...p);

const tables = await q<{ table_name: string }>(`
  SELECT table_name FROM information_schema.tables
   WHERE table_schema='public' AND (table_name ILIKE '%event%' OR table_name ILIKE '%revision%'
     OR table_name ILIKE '%lifecycle%' OR table_name ILIKE '%audit%') ORDER BY table_name`);
console.log('\n── tables d\'historique disponibles ──');
for (const t of tables) console.log(`   ${t.table_name}`);

/* Quand les sources non-ACTIVE ont-elles été touchées pour la dernière fois ? */
console.log('\n── dates de dernière modification des sources non-ACTIVE ──\n');
const dates = await q<{ jour: string; statut: string; n: bigint }>(`
  SELECT to_char("updatedAt", 'YYYY-MM-DD') AS jour, status AS statut, count(*) AS n
    FROM "Source" WHERE status <> 'ACTIVE'
   GROUP BY 1, 2 ORDER BY 1 DESC, 2`);
for (const d of dates) console.log(`   ${d.jour}   ${d.statut.padEnd(9)} ${String(d.n).padStart(4)}`);

console.log('\n── les 36 « jamais démarrées » : quand ont-elles été touchées ? ──\n');
const jamais = await q<{ key: string; status: string; updatedAt: Date; createdAt: Date | null }>(`
  SELECT s.key, s.status, s."updatedAt", s."createdAt"
    FROM "Source" s
   WHERE s.status <> 'ACTIVE' AND (s.note IS NULL OR s.note = '')
     AND NOT EXISTS (SELECT 1 FROM "SourceRun" r WHERE r."sourceKey" = s.key)
   ORDER BY s."updatedAt" DESC`);
for (const j of jamais)
  console.log(`   ${j.key.padEnd(26)} ${j.status.padEnd(9)} créée ${j.createdAt ? j.createdAt.toISOString().slice(0, 10) : '—'}   modifiée ${j.updatedAt.toISOString().slice(0, 16)}`);

console.log('');
await prisma.$disconnect();

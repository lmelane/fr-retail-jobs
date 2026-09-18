/**
 * LES DÉCLENCHEURS POSÉS SUR UNE TABLE — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/lire-declencheurs.mts Source
 *
 * Avant d'écrire dans une table protégée, savoir CE QUI la protège. Le schéma Prisma ne montre pas
 * les déclencheurs : ils vivent dans les migrations SQL et ne se lisent qu'en base.
 */
import { PrismaClient } from '@prisma/client';

const table = process.argv[2];
if (!table) {
  console.error('Usage : lire-declencheurs.mts <Table>');
  process.exit(2);
}

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

type Ligne = { tgname: string; declaration: string };
const rows = await prisma.$queryRawUnsafe<Ligne[]>(`
  SELECT t.tgname, pg_get_triggerdef(t.oid) AS declaration
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = $1 AND NOT t.tgisinternal ORDER BY t.tgname`, table);

console.log(`\n"${table}" — ${rows.length} déclencheur(s)\n`);
for (const r of rows) {
  console.log(`   ${r.tgname}`);
  console.log(`      ${r.declaration.replace(/\s+/g, ' ').slice(0, 190)}`);
}
console.log('');

await prisma.$disconnect();

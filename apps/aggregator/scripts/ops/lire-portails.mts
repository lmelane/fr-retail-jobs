/**
 * LIRE LE PORTAIL CONFIGURÉ D'UNE OU PLUSIEURS SOURCES — lecture seule, aucune écriture.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/lire-portails.mts bespoke-post aeyde
 *
 * Sans argument : toutes les sources ACTIVE.
 *
 * Pourquoi ce script existe : la campagne refuse une source en affichant une URL qu'elle vient de
 * construire, et il faut pouvoir relire CETTE URL — celle que `configuredPortal` rend — sans
 * relancer une collecte. C'est la même fonction que l'inspecteur d'identité appelle
 * (`sourceRelation.ts:102`), donc ce qu'on lit ici est exactement ce qu'il comparera.
 */
import { PrismaClient } from '@prisma/client';
import { configuredPortal } from '../../src/connectors/sourcePortal.js';
import { effectiveSourceConfig } from '../../src/connectors/sourceConfig.js';

const cles = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

type Ligne = { key: string; maison: string; kind: string; status: string; careersDomain: string | null; config: unknown };

const rows = cles.length
  ? await prisma.$queryRawUnsafe<Ligne[]>(
      `SELECT key, maison, kind, status, "careersDomain", config FROM "Source" WHERE key = ANY($1::text[]) ORDER BY key`, cles)
  : await prisma.$queryRawUnsafe<Ligne[]>(
      `SELECT key, maison, kind, status, "careersDomain", config FROM "Source" WHERE status = 'ACTIVE' ORDER BY key`);

for (const s of rows) {
  const portail = configuredPortal(s.kind, effectiveSourceConfig(s.config as Record<string, unknown>));
  console.log(`\n${s.key}  [${s.status}]  ${s.kind}`);
  console.log(`   maison        : ${s.maison}`);
  console.log(`   careersDomain : ${s.careersDomain ?? '(vide)'}`);
  console.log(`   portail       : ${portail ? portail.url : '(non qualifié)'}`);
}
console.log(`\n${rows.length} source(s).`);

await prisma.$disconnect();

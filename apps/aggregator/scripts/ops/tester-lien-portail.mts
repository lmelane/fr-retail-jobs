/**
 * LE CONTRAT DE PORTAIL RECONNAÎT-IL CE LIEN ? — lecture seule, aucune écriture, aucun réseau.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/tester-lien-portail.mts <cle-source> <url> [<url>…]
 *
 * Pourquoi : quand la campagne rend `EXACT_PORTAL_REFERENCE_NOT_FOUND` alors que la page officielle
 * porte visiblement un lien vers le portail, la question est de savoir si c'est `portal.matches()`
 * qui refuse ce lien — et sur quel détail (variante d'hôte, requête, fragment, barre finale).
 * Ce script appelle EXACTEMENT les fonctions que l'inspecteur appelle (`sourceRelation.ts:142-143`),
 * sans rien réimplémenter : ce qu'il dit ici est ce que l'inspecteur dira.
 */
import { PrismaClient } from '@prisma/client';
import { configuredPortal } from '../../src/connectors/sourcePortal.js';
import { effectiveSourceConfig } from '../../src/connectors/sourceConfig.js';

const [cle, ...urls] = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!cle || !urls.length) {
  console.error('Usage : tester-lien-portail.mts <cle-source> <url> [<url>…]');
  process.exit(2);
}

const dbUrl = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

type Ligne = { key: string; kind: string; config: unknown };
const [source] = await prisma.$queryRawUnsafe<Ligne[]>(
  `SELECT key, kind, config FROM "Source" WHERE key = $1`, cle);
if (!source) {
  console.error(`Source « ${cle} » absente du registre.`);
  await prisma.$disconnect();
  process.exit(1);
}

const portail = configuredPortal(source.kind, effectiveSourceConfig(source.config as Record<string, unknown>));
if (!portail) {
  console.error(`Aucun contrat de portail pour ${source.key} (${source.kind}).`);
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`\n${source.key} (${source.kind})`);
console.log(`   portail configuré : ${portail.url}\n`);

for (const brut of urls) {
  /*
   * L'inspecteur résout le lien avec `new URL(reference, base)` AVANT de tester : un href relatif ou
   * porteur d'un fragment arrive donc normalisé. On fait pareil, sinon on testerait autre chose que lui.
   */
  let resolue: string;
  try { resolue = new URL(brut).toString(); }
  catch { console.log(`   ${brut}\n      URL invalide`); continue; }

  const listing = portail.matches(resolue);
  const offre = portail.matchesPosting(resolue);
  const verdict = listing ? 'LISTING (témoin portal)' : offre ? 'OFFRE (témoin posting)' : 'REFUSÉ';
  console.log(`   ${brut}`);
  if (resolue !== brut) console.log(`      résolue   : ${resolue}`);
  console.log(`      matches() : ${listing} · matchesPosting() : ${offre}  →  ${verdict}`);
}

console.log('');
await prisma.$disconnect();

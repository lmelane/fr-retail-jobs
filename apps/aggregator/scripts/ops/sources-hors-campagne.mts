/**
 * QUELLES SOURCES ACTIVE LA CAMPAGNE NE VOIT-ELLE PAS ? — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/sources-hors-campagne.mts <candidats.json>
 *
 * ── POURQUOI ───────────────────────────────────────────────────────────────────────────────────
 *
 * `source-campaign-candidates.sql` ne rend PAS toutes les sources ACTIVE : il filtre sur les
 * familles « sous contrat de portail ». Une source absente de l'export n'est donc jamais instruite
 * — elle ne sort ni QUALIFIEE ni REFUSEE, elle est simplement invisible, et son absence du
 * catalogue ressemble à un échec de collecte alors que c'est un silence.
 *
 * Compter le catalogue ne révèle jamais ce trou : il ne montre que ce qui est entré. Ce script
 * mesure l'écart entre les sources ACTIVE du registre et les candidats réellement soumis, pour que
 * « il manque quoi ? » ait une réponse complète et non la réponse des seuls candidats visibles.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

const fichier = process.argv[2];
if (!fichier) {
  console.error('Usage : sources-hors-campagne.mts <candidats.json>');
  process.exit(2);
}

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

const candidats = new Set<string>(
  (JSON.parse(readFileSync(fichier, 'utf8')) as Array<{ key: string }>).map((c) => c.key));

type Ligne = { key: string; maison: string; kind: string; tier: string; careersDomain: string | null };
const actives = await prisma.$queryRawUnsafe<Ligne[]>(`
  SELECT key, maison, kind, tier, "careersDomain" FROM "Source"
   WHERE status = 'ACTIVE' ORDER BY kind, key`);

const hors = actives.filter((s) => !candidats.has(s.key));

console.log(`\n${actives.length} source(s) ACTIVE · ${candidats.size} candidat(s) soumis · ${hors.length} HORS CAMPAGNE\n`);

const parFamille = new Map<string, Ligne[]>();
for (const s of hors) parFamille.set(s.kind, [...(parFamille.get(s.kind) ?? []), s]);

for (const [kind, lignes] of [...parFamille].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`   ${kind}  (${lignes.length})`);
  for (const s of lignes) {
    console.log(`      ${s.key.padEnd(26)} ${s.tier.padEnd(20)} ${s.careersDomain ?? '(domaine carrières vide)'}   ${s.maison}`);
  }
}

if (!hors.length) console.log('   Aucune : toutes les sources ACTIVE sont soumises à la campagne.');
console.log('');

await prisma.$disconnect();

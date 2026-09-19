/**
 * PRÉPARER LA PASSE DE RATTRAPAGE — lecture seule, écrit un fichier de vagues.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/preparer-rattrapage.mts <vagues.json> [<taille>]
 *
 * ── CE QU'ON A APPRIS DE LA PASSE PRÉCÉDENTE ───────────────────────────────────────────────────
 *
 * Une vague dispose de 20 minutes, quel que soit le nombre de sources qu'elle porte. Avec 12
 * sources, chacune n'a donc que 1 min 40 en moyenne — or les grosses en demandent beaucoup plus :
 * LVMH a mis ~8 min (6 141 offres), adidas 218 s, Kering 401 s lors d'un test direct.
 *
 * Résultat mesuré le 19/09/2026 : les vagues 5 à 9 ont toutes été incomplètes, et les sources
 * placées en fin de vague — Kering, L'Oréal, Nike, Nordstrom, Richemont, Ralph Lauren — n'ont
 * jamais été atteintes. Elles ne sont bloquées par RIEN : elles manquent de temps.
 *
 * Ce script construit donc des vagues COURTES, pour que chaque source dispose de plusieurs
 * minutes. Il ne prend que les sources ACTIVE sans décision d'accès : ni les refusées (il n'y en
 * a aucune), ni les qualifiées (rien à refaire).
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const sortie = process.argv[2];
const taille = Number(process.argv[3] ?? 4);
if (!sortie) { console.error('Usage : preparer-rattrapage.mts <vagues.json> [<taille>]'); process.exit(2); }

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL } } });

/*
 * `wttj-sector` est volontairement hors campagne (agrégateur sectoriel sans Maison propre, cf.
 * source-campaign-candidates.sql) : l'inclure ferait échouer la vague sur un candidat absent.
 */
const sources = await prisma.$queryRawUnsafe<Array<{ key: string; maison: string; kind: string }>>(`
  SELECT s.key, s.maison, s.kind FROM "Source" s
   WHERE s.status = 'ACTIVE' AND s.key <> 'wttj-sector'
     AND NOT EXISTS (SELECT 1 FROM "SourceAccessDecision" d WHERE d."sourceKey" = s.key)
   ORDER BY s.kind, s.key`);

const vagues = [];
for (let i = 0; i < sources.length; i += taille)
  vagues.push({ kind: 'rattrapage', keys: sources.slice(i, i + taille).map((s) => s.key) });

writeFileSync(sortie, JSON.stringify(vagues, null, 1), 'utf8');

console.log(`\n   ${sources.length} source(s) sans décision → ${vagues.length} vague(s) de ${taille}`);
console.log(`   soit ~${Math.round(20 / taille)} min par source (contre ~1,7 min en vagues de 12)\n`);

const parFamille = new Map<string, number>();
for (const s of sources) parFamille.set(s.kind, (parFamille.get(s.kind) ?? 0) + 1);
console.log('   par famille :\n');
for (const [k, n] of [...parFamille].sort((a, b) => b[1] - a[1]).slice(0, 12))
  console.log(`      ${k.padEnd(30)} ${String(n).padStart(4)}`);

console.log(`\n   durée estimée : ${Math.round((vagues.length * 22) / 60)} h ${(vagues.length * 22) % 60} min\n`);
console.log(`   écrit dans ${sortie}\n`);

await prisma.$disconnect();

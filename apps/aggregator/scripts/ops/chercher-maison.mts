/**
 * CHERCHER UNE MAISON PARTOUT DANS LE REGISTRE — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/chercher-maison.mts <motif> [<motif>…]
 *
 * Répond à « est-ce que nous avons déjà cette Maison ? » sans supposer par quel libellé elle
 * est entrée : on cherche dans `Company.name`, `Source.maison`, `Source.key` et
 * `Source.careersDomain`, en insensible à la casse et aux accents.
 */
import { PrismaClient } from '@prisma/client';

const motifs = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!motifs.length) { console.error('Usage : chercher-maison.mts <motif>…'); process.exit(2); }

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

for (const motif of motifs) {
  console.log(`\n═══ « ${motif} » ═══`);
  const like = `%${motif}%`;

  const cies = await prisma.$queryRawUnsafe<Array<{ name: string; domain: string | null; offres: bigint }>>(
    `SELECT c.name, c.domain, (SELECT count(*) FROM "Job" j WHERE j."companyId"=c.id AND j."isActive") AS offres
       FROM "Company" c WHERE c.name ILIKE $1 ORDER BY c.name LIMIT 20`, like);
  console.log(`\n   Company — ${cies.length} ligne(s)`);
  for (const c of cies) console.log(`      ${c.name.padEnd(42)} ${(c.domain ?? '—').padEnd(30)} ${c.offres} offre(s)`);

  const srcs = await prisma.$queryRawUnsafe<Array<{ key: string; maison: string; kind: string; status: string; careersDomain: string | null; lastRunJobs: number | null; lastRunStatus: string | null }>>(
    `SELECT key, maison, kind, status, "careersDomain", "lastRunJobs", "lastRunStatus"
       FROM "Source" WHERE maison ILIKE $1 OR key ILIKE $1 OR "careersDomain" ILIKE $1
       ORDER BY key LIMIT 20`, like);
  console.log(`\n   Source — ${srcs.length} ligne(s)`);
  for (const s of srcs)
    console.log(`      ${s.key.padEnd(28)} ${s.kind.padEnd(20)} ${s.status.padEnd(9)} ${(s.careersDomain ?? '—').padEnd(28)} ${s.lastRunJobs ?? '—'} offre(s) · ${s.lastRunStatus ?? '—'}`);
}

console.log('');
await prisma.$disconnect();

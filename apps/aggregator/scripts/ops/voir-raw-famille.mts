/**
 * LA FORME RÉELLE DU RAW CONSERVÉ POUR UNE FAMILLE — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/voir-raw-famille.mts <famille>…
 *
 * Avant de brancher une famille au rejeu (`recovery.ts`), il faut savoir ce que le collecteur a
 * RÉELLEMENT conservé dans `JobSource.raw` : un objet JSON, du HTML, une entrée de liste enrichie.
 * Le deviner conduit à écrire un lecteur qui ne lit rien.
 */
import { PrismaClient } from '@prisma/client';

const familles = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!familles.length) { console.error('Usage : voir-raw-famille.mts <famille>…'); process.exit(2); }

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL } } });

for (const f of familles) {
  console.log(`\n═══════════ ${f} ═══════════`);
  const rows = await prisma.$queryRawUnsafe<Array<{ sourceKey: string; externalId: string; url: string; raw: unknown }>>(
    `SELECT js."sourceKey", js."externalId", js.url, js.raw
       FROM "JobSource" js JOIN "Source" s ON s.key = js."sourceKey"
      WHERE s.kind = $1 AND js.raw IS NOT NULL LIMIT 2`, f);
  if (!rows.length) { console.log('   aucun RAW conservé pour cette famille'); continue; }
  for (const r of rows) {
    console.log(`\n   ── ${r.sourceKey} / ${r.externalId}`);
    console.log(`      url : ${r.url}`);
    const raw = r.raw as Record<string, unknown> | string;
    if (typeof raw === 'string') { console.log(`      RAW (texte, ${raw.length} car.) : ${raw.slice(0, 200)}`); continue; }
    console.log(`      clés : ${Object.keys(raw).join(', ')}`);
    for (const [k, v] of Object.entries(raw).slice(0, 12))
      console.log(`         ${k.padEnd(22)} ${JSON.stringify(v)?.slice(0, 90)}`);
  }
}
console.log('');
await prisma.$disconnect();

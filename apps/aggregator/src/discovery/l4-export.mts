import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

/**
 * l4 (ville canonique) — export LECTURE SEULE des couples (ville, lieu) actifs
 * de la base, avec leur source principale et leur effectif.
 *
 * Usage : DATABASE_URL=… npx tsx src/discovery/l4-export.mts <sortie.json>
 * Un seul SELECT ; aucune écriture. La simulation avant/après se fait ensuite
 * hors base (`l4-simulate.mts`), avec les vraies fonctions de `normalize/location.ts`.
 */
const out = process.argv[2];
if (!out) throw new Error('usage: l4-export.mts <sortie.json>');

type Row = { city: string | null; location: string | null; source: string | null; n: number };

const p = new PrismaClient();
const rows = await p.$queryRawUnsafe<Row[]>(`
  SELECT j.city, j.location, s."sourceKey" AS source, count(*)::int AS n
  FROM "Job" j
  LEFT JOIN LATERAL (
    SELECT "sourceKey" FROM "JobSource" WHERE "jobId" = j.id ORDER BY "lastSeenAt" DESC LIMIT 1
  ) s ON true
  WHERE j."isActive"
  GROUP BY 1, 2, 3
  ORDER BY 4 DESC
`);
await p.$disconnect();

const total = rows.reduce((acc, r) => acc + r.n, 0);
writeFileSync(out, JSON.stringify({ exportedAt: new Date().toISOString(), total, rows }, null, 0));
console.log(`${rows.length} couples (ville, lieu, source) — ${total} offres actives → ${out}`);

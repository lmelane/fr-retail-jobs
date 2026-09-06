import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

/**
 * Audit a4 (informations des offres) — exécuteur de SELECT en lecture seule.
 * Usage : npx tsx src/discovery/a4-sql.mts <fichier.sql>
 * Blocs séparés par `---`, nommés par `-- name: xxx`. Refuse tout ce qui
 * n'est pas SELECT/WITH.
 */
const file = process.argv[2];
if (!file) throw new Error('usage: a4-sql.mts <file.sql>');
const blocks = readFileSync(file, 'utf8')
  .split(/^---\s*$/m)
  .map((b) => b.trim())
  .filter(Boolean);

const p = new PrismaClient();
for (const block of blocks) {
  const nameMatch = block.match(/^--\s*name:\s*(.+)$/m);
  const name = nameMatch?.[1]?.trim() ?? '(sans nom)';
  const sql = block.replace(/^--.*$/gm, '').trim();
  if (!/^(select|with)\b/i.test(sql)) throw new Error(`bloc "${name}" n'est pas un SELECT`);
  const started = Date.now();
  try {
    const rows = await p.$queryRawUnsafe<Record<string, unknown>[]>(sql);
    const out = rows.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])),
    );
    console.log(`\n## ${name} (${out.length} lignes, ${Date.now() - started} ms)`);
    console.log(JSON.stringify(out, null, 1));
  } catch (error) {
    console.log(`\n## ${name} ERREUR: ${(error as Error).message}`);
  }
}
await p.$disconnect();

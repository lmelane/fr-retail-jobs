/**
 * REPLAY CONTRAT — la mesure exigée avant toute généralisation.
 *
 * LECTURE SEULE par défaut : rejoue `enrichContract` sur le `raw` déjà stocké
 * en base et compare à la colonne canonique actuelle. Aucun réseau, aucune
 * écriture — c'est la démonstration de la règle 2 (rejouable sans re-scraper).
 *
 *   DATABASE_URL=<prod> npx tsx src/enrich/replay-contract.mts
 */

import { PrismaClient } from '@prisma/client';
import { enrichContract } from './contract.js';
import { CONTRACT_NORMALIZER_VERSION } from './contract.js';

const prisma = new PrismaClient();
const BATCH = 5000;

type Tally = {
  scanned: number;
  hadContract: number;
  /** Offres vides que le moteur remplit — le gain net. */
  added: number;
  /** Offres déjà remplies dont le moteur CHANGE la valeur : à examiner. */
  changed: number;
  /** Offres déjà remplies que le moteur confirme. */
  confirmed: number;
  /** Toujours sans preuve suffisante. */
  stillUnknown: number;
  byMethod: Map<string, number>;
  byConfidence: Map<number, number>;
  byValue: Map<string, number>;
  /** Échantillons pour l'inspection humaine. */
  changes: { title: string; before: string; after: string; method: string; raw?: string }[];
  additions: { title: string; after: string; method: string; raw?: string; path?: string }[];
};

function bump<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

async function main(): Promise<void> {
  const t: Tally = {
    scanned: 0, hadContract: 0, added: 0, changed: 0, confirmed: 0, stillUnknown: 0,
    byMethod: new Map(), byConfidence: new Map(), byValue: new Map(), changes: [], additions: [],
  };

  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.job.findMany({
      where: { isActive: true },
      select: { id: true, title: true, description: true, contract: true, raw: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      t.scanned++;
      if (row.contract) t.hadContract++;

      const result = enrichContract({
        contract: row.contract,
        title: row.title,
        description: row.description,
        raw: row.raw,
      });

      if (!result || result.normalized === null) {
        if (!row.contract) t.stillUnknown++;
        continue;
      }

      bump(t.byMethod, result.method);
      bump(t.byConfidence, result.confidence);
      bump(t.byValue, result.normalized);

      if (!row.contract) {
        t.added++;
        if (t.additions.length < 15) {
          t.additions.push({
            title: row.title.slice(0, 58),
            after: result.normalized,
            method: result.method,
            raw: result.raw?.slice(0, 30),
            path: result.sourcePath,
          });
        }
      } else if (row.contract !== result.normalized) {
        t.changed++;
        if (t.changes.length < 25) {
          t.changes.push({
            title: row.title.slice(0, 52),
            before: row.contract,
            after: result.normalized,
            method: result.method,
            raw: result.raw?.slice(0, 26),
          });
        }
      } else {
        t.confirmed++;
      }
    }
    process.stderr.write(`  … ${t.scanned} offres balayées\r`);
  }

  const pct = (n: number) => `${((n / t.scanned) * 100).toFixed(1)} %`;
  const before = t.hadContract;
  const after = t.hadContract + t.added;

  console.log(`\n=== REPLAY ${CONTRACT_NORMALIZER_VERSION} — lecture seule, sans re-crawl ===\n`);
  console.log(`Offres actives balayées      ${t.scanned}`);
  console.log(`Complétude AVANT             ${before} (${pct(before)})`);
  console.log(`Complétude APRÈS             ${after} (${pct(after)})`);
  console.log(`  → offres enrichies         +${t.added}`);
  console.log(`  → valeurs confirmées       ${t.confirmed}`);
  console.log(`  → valeurs CHANGÉES         ${t.changed}  (à inspecter : régression possible)`);
  console.log(`  → toujours sans contrat    ${t.stillUnknown} (${pct(t.stillUnknown)})`);

  console.log(`\n--- répartition par method ---`);
  for (const [m, n] of [...t.byMethod].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${m.padEnd(18)} ${String(n).padStart(6)}`);
  }
  console.log(`\n--- répartition par confidence ---`);
  for (const [c, n] of [...t.byConfidence].sort((a, b) => b[0] - a[0])) {
    console.log(`  ${String(c).padEnd(18)} ${String(n).padStart(6)}`);
  }
  console.log(`\n--- valeurs produites ---`);
  for (const [v, n] of [...t.byValue].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.padEnd(18)} ${String(n).padStart(6)}`);
  }

  console.log(`\n--- échantillon d'AJOUTS (colonne vide → remplie) ---`);
  for (const a of t.additions) {
    console.log(`  ${a.after.padEnd(11)} ${a.method.padEnd(16)} ${(a.path ?? '-').padEnd(16)} « ${a.raw ?? ''} » ${a.title}`);
  }
  console.log(`\n--- TOUS les CHANGEMENTS échantillonnés (régressions potentielles) ---`);
  if (t.changes.length === 0) console.log('  aucun');
  for (const c of t.changes) {
    console.log(`  ${c.before.padEnd(11)} → ${c.after.padEnd(11)} ${c.method.padEnd(16)} « ${c.raw ?? ''} » ${c.title}`);
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

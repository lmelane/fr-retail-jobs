/**
 * BACKFILL des cinq dimensions d'emploi — matérialise en base ce que le dry-run
 * a calculé, SANS RÉSEAU et sans re-scraper une seule source.
 *
 * Pourquoi il est indispensable (constat Loïc, 2026-09-08) : la migration
 * atomique a converti les ANCIENNES COLONNES, mais pas l'enrichissement lu dans
 * le `raw` et les titres. D'où l'écart mesuré juste après :
 *
 *              dry-run cible   prod après migration
 *   employmentTerm  22 581            20 096
 *   workTime        50 813            46 168
 *   programType      4 483             4 297
 *   engagementType     215               112
 *   isSeasonal       2 430                 0   ← la preuve la plus nette
 *
 * Laisser les prochains ingests combler cet écart ferait dépendre la base
 * canonique du hasard du passage des 440 sources, alors que le moteur est
 * précisément rejouable hors ligne. C'est toute la valeur de l'architecture
 * RAW → extraction → normalisation → colonne canonique.
 *
 * GARDE-FOU CENTRAL : ce backfill ne REMPLIT que des dimensions VIDES. Une
 * valeur déjà posée par une meilleure provenance (la colonne convertie, donc un
 * champ déclaré par la source) n'est JAMAIS écrasée par une inférence de titre.
 *
 *   DATABASE_URL=<prod> npx tsx scripts/enrich/backfill-employment.mts          (à blanc)
 *   DATABASE_URL=<prod> npx tsx scripts/enrich/backfill-employment.mts --apply  (écrit)
 */

import { PrismaClient } from '@prisma/client';
import { readEmployment, decomposeCompositeCode, extractEmployment, type Employment } from '../../src/normalize/employment.js';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const BATCH = 2000;

const DIMS = ['employmentTerm', 'workTime', 'programType', 'engagementType'] as const;
type Dim = (typeof DIMS)[number];

/** Les clés du payload qui portent une information d'emploi, mesurées en base. */
const RAW_KEYS = [
  'employment_type_code', 'fullTimePartTimeFilter', 'employmentType', 'employment_type',
  'contractType', 'contract_type', 'timeType', 'jobType', 'job_type',
  'bulletFields', 'category', 'categories', 'tags1', 'tags2', 'tags3', 'tags4', 'tags5', 'tags6',
] as const;

function valuesAt(payload: Record<string, unknown>, key: string): string[] {
  const v = payload[key];
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((e) => String(e ?? '').trim()).filter(Boolean);
  return [String(v).trim()].filter(Boolean);
}

const filled = new Map<Dim, number>(DIMS.map((d) => [d, 0]));
let seasonalSet = 0;
let conflicts = 0;
let rowsChanged = 0;
let scanned = 0;

async function main(): Promise<void> {
  const activeAtStart = await prisma.job.count({ where: { isActive: true } });
  console.log(`Population active au démarrage : ${activeAtStart}`);
  console.log(APPLY ? 'MODE ÉCRITURE\n' : 'MODE À BLANC (ajouter --apply pour écrire)\n');

  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.job.findMany({
      where: { isActive: true },
      select: {
        id: true, title: true, description: true, raw: true,
        employmentTerm: true, workTime: true, programType: true, engagementType: true, isSeasonal: true,
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    const updates: { id: string; data: Record<string, string | boolean> }[] = [];

    for (const row of rows) {
      scanned++;

      /**
       * Ce que la SOURCE dit, accumulé par ordre de fiabilité décroissante.
       * La première preuve gagne pour chaque dimension.
       */
      const read: Employment = {};
      const take = (from: Employment) => {
        for (const dim of DIMS) {
          const incoming = from[dim];
          if (!incoming) continue;
          if (read[dim] === undefined) (read as Record<string, string>)[dim] = incoming;
          else if (read[dim] !== incoming) conflicts++;
        }
        if (from.isSeasonal && !read.isSeasonal) read.isSeasonal = true;
      };

      const raw = row.raw;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const payload = raw as Record<string, unknown>;
        for (const key of RAW_KEYS) {
          for (const value of valuesAt(payload, key)) {
            take(decomposeCompositeCode(value));
            take(readEmployment(value));
          }
        }
      }
      take(extractEmployment(row.title, row.description));

      /**
       * L'ÉCRITURE, strictement additive : on ne touche qu'une dimension VIDE.
       * Une valeur issue de la colonne convertie — donc d'un champ déclaré par
       * la source — a une meilleure provenance qu'une inférence de titre et
       * reste intouchée.
       */
      const data: Record<string, string | boolean> = {};
      for (const dim of DIMS) {
        if (row[dim] === null && read[dim]) {
          data[dim] = read[dim] as string;
          filled.set(dim, (filled.get(dim) ?? 0) + 1);
        }
      }
      if (row.isSeasonal === null && read.isSeasonal) {
        data.isSeasonal = true;
        seasonalSet++;
      }
      if (Object.keys(data).length > 0) updates.push({ id: row.id, data });
    }

    if (APPLY && updates.length > 0) {
      // Séquentiel par lot : ces écritures ne se disputent aucune ligne, et
      // rester modeste évite de saturer le pool pendant qu'un autre service lit.
      for (const u of updates) {
        await prisma.job.update({ where: { id: u.id }, data: u.data });
      }
    }
    rowsChanged += updates.length;
    process.stderr.write(`  … ${scanned} balayées, ${rowsChanged} lignes à modifier\r`);
  }

  console.log(`\n\n=== BACKFILL ${APPLY ? '(APPLIQUÉ)' : '(À BLANC)'} ===`);
  console.log(`Offres balayées            ${scanned}`);
  console.log(`Lignes modifiées           ${rowsChanged}`);
  console.log(`Conflits entre preuves     ${conflicts}`);
  console.log(`\nDimensions REMPLIES (elles étaient vides) :`);
  for (const dim of DIMS) console.log(`  ${dim.padEnd(18)} +${filled.get(dim)}`);
  console.log(`  ${'isSeasonal'.padEnd(18)} +${seasonalSet}`);

  const after = await prisma.job.groupBy({ by: ['employmentTerm'], where: { isActive: true }, _count: true });
  console.log(`\nÉtat final employmentTerm :`);
  for (const r of after) console.log(`  ${(r.employmentTerm ?? '(null)').padEnd(18)} ${r._count}`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

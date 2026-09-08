/**
 * DRY-RUN des quatre dimensions d'emploi — exigé par Loïc avant toute écriture.
 *
 * LECTURE SEULE, SANS RÉSEAU. Rejoue le moteur cible sur les 71 629 offres
 * actives et produit, pour chaque dimension : rempli avant / après, l'origine
 * exacte de chaque valeur (colonne contract, colonne seniority, champ du raw,
 * titre), les conflits entre preuves, et la répartition finale.
 *
 *   DATABASE_URL=<prod> npx tsx src/enrich/dryrun-employment.mts
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import { readEmployment, decomposeCompositeCode, extractEmployment, type Employment } from '../normalize/employment.js';

const prisma = new PrismaClient();
const BATCH = 5000;

/** Les dimensions, dans l'ordre du rapport. */
const DIMS = ['employmentTerm', 'workTime', 'programType', 'engagementType'] as const;
type Dim = (typeof DIMS)[number];

/** D'où vient une valeur — la provenance exigée au rapport. */
type Origin = 'contract' | 'seniority' | 'workingTime' | 'raw' | 'title' | 'description';

type Stats = {
  before: number;
  after: number;
  byOrigin: Map<Origin, number>;
  byValue: Map<string, number>;
  conflicts: number;
  conflictSamples: string[];
};

/** `isSeasonal` n'est pas une dimension à valeurs : ses compteurs sont à part. */
const seasonal = {
  total: 0,
  byOrigin: new Map<Origin, number>(),
  withFixedTerm: 0,
  withTemporary: 0,
  withPermanent: 0,
  withoutTerm: 0,
};

/** Conflits workTime par SOURCE : un adaptateur systématiquement faux doit se voir. */
const workTimeConflictBySource = new Map<string, number>();

const stats = new Map<Dim, Stats>(
  DIMS.map((d) => [d, { before: 0, after: 0, byOrigin: new Map(), byValue: new Map(), conflicts: 0, conflictSamples: [] }]),
);

function bump<K>(m: Map<K, number>, k: K): void { m.set(k, (m.get(k) ?? 0) + 1); }

/**
 * Les clés du payload qui portent une information d'emploi, mesurées en base.
 * `employment_type_code` et `fullTimePartTimeFilter` sont les deux champs
 * dédiés découverts par l'audit ; les autres sont les porteurs habituels.
 */
const RAW_KEYS = [
  'employment_type_code', 'fullTimePartTimeFilter', 'employmentType', 'employment_type',
  'contractType', 'contract_type', 'timeType', 'jobType', 'job_type',
  'bulletFields', 'category', 'categories', 'tags1', 'tags2', 'tags3', 'tags4', 'tags5', 'tags6',
] as const;

/** Les valeurs textuelles d'une clé, quel que soit son type. */
function valuesAt(payload: Record<string, unknown>, key: string): string[] {
  const v = payload[key];
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((e) => String(e ?? '').trim()).filter(Boolean);
  return [String(v).trim()].filter(Boolean);
}

/** Fusionne une preuve dans l'accumulateur, sans écraser une dimension déjà décidée. */
function merge(into: Employment, from: Employment, origin: Origin, origins: Map<Dim, Origin>, onConflict: (d: Dim, a: string, b: string) => void): void {
  for (const dim of DIMS) {
    const incoming = from[dim];
    if (!incoming) continue;
    const current = into[dim];
    if (current === undefined) {
      (into as Record<string, string>)[dim] = incoming;
      origins.set(dim, origin);
    } else if (current !== incoming) {
      // Deux preuves se contredisent : la PREMIÈRE (la plus prioritaire) reste.
      onConflict(dim, current, incoming);
    }
  }
}

async function main(): Promise<void> {
  let scanned = 0;
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.job.findMany({
      where: { isActive: true },
      select: {
        id: true, title: true, description: true, contract: true, workingTime: true, seniority: true, raw: true,
        sources: { where: { isActive: true }, select: { sourceKey: true }, take: 1 },
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      scanned++;

      // — Complétude AVANT, dans l'ancien modèle —
      if (row.contract && ['CDI', 'CDD', 'INTERIM'].includes(row.contract)) stats.get('employmentTerm')!.before++;
      if (row.workingTime) stats.get('workTime')!.before++;
      if (row.contract && ['STAGE', 'ALTERNANCE', 'GRADUATE', 'VIE'].includes(row.contract)) stats.get('programType')!.before++;
      if (row.contract === 'FREELANCE') stats.get('engagementType')!.before++;

      const out: Employment = {};
      const origins = new Map<Dim, Origin>();
      let seasonalOrigin: Origin | undefined;
      const sourceKey = row.sources[0]?.sourceKey ?? '(sans source)';
      const conflict = (dim: Dim, kept: string, dropped: string) => {
        const s = stats.get(dim)!;
        s.conflicts++;
        if (dim === 'workTime') {
          workTimeConflictBySource.set(sourceKey, (workTimeConflictBySource.get(sourceKey) ?? 0) + 1);
        }
        if (s.conflictSamples.length < 8) {
          s.conflictSamples.push(`${kept} vs ${dropped} — [${sourceKey}] « ${row.title.slice(0, 40)} »`);
        }
      };
      /** Le drapeau saisonnier se pose sans jamais entrer en conflit avec une durée. */
      const flagSeasonal = (from: Employment, origin: Origin) => {
        if (from.isSeasonal && !out.isSeasonal) { out.isSeasonal = true; seasonalOrigin = origin; }
      };

      // 1. La colonne `contract` : la décision déjà prise, la plus fiable.
      merge(out, readEmployment(row.contract), 'contract', origins, conflict);
      flagSeasonal(readEmployment(row.contract), 'contract');
      // 2. La colonne `workingTime` (TEMPS_PLEIN / TEMPS_PARTIEL).
      if (row.workingTime) {
        const wt = row.workingTime === 'TEMPS_PLEIN' ? 'FULL_TIME' : row.workingTime === 'TEMPS_PARTIEL' ? 'PART_TIME' : undefined;
        if (wt) merge(out, { workTime: wt }, 'workingTime', origins, conflict);
      }
      // 3. La colonne `seniority`, dépolluée : INTERNSHIP/APPRENTICESHIP/GRADUATE
      //    y sont des PROGRAMMES et doivent en sortir.
      if (row.seniority && ['INTERNSHIP', 'APPRENTICESHIP', 'GRADUATE'].includes(row.seniority)) {
        const mapped = row.seniority === 'GRADUATE' ? 'GRADUATE_PROGRAM' : (row.seniority as 'INTERNSHIP' | 'APPRENTICESHIP');
        merge(out, { programType: mapped }, 'seniority', origins, conflict);
      }
      // 4. Le payload brut — le gisement mesuré (employment_type_code…).
      const raw = row.raw;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const payload = raw as Record<string, unknown>;
        for (const key of RAW_KEYS) {
          for (const value of valuesAt(payload, key)) {
            merge(out, decomposeCompositeCode(value), 'raw', origins, conflict);
            merge(out, readEmployment(value), 'raw', origins, conflict);
            flagSeasonal(decomposeCompositeCode(value), 'raw');
            flagSeasonal(readEmployment(value), 'raw');
          }
        }
      }
      // 5. Le titre et le texte, en dernier recours.
      merge(out, extractEmployment(row.title, row.description), 'title', origins, conflict);
      flagSeasonal(extractEmployment(row.title, row.description), 'title');

      if (out.isSeasonal) {
        seasonal.total++;
        bump(seasonal.byOrigin, seasonalOrigin ?? 'raw');
        if (out.employmentTerm === 'FIXED_TERM') seasonal.withFixedTerm++;
        else if (out.employmentTerm === 'TEMPORARY') seasonal.withTemporary++;
        else if (out.employmentTerm === 'PERMANENT') seasonal.withPermanent++;
        else seasonal.withoutTerm++;
      }

      for (const dim of DIMS) {
        const value = out[dim];
        if (!value) continue;
        const s = stats.get(dim)!;
        s.after++;
        bump(s.byValue, value);
        bump(s.byOrigin, origins.get(dim) ?? 'raw');
      }
    }
    process.stderr.write(`  … ${scanned} offres\r`);
  }

  const pct = (n: number) => `${((n / scanned) * 100).toFixed(1)} %`;
  console.log(`\n=== DRY-RUN 4 DIMENSIONS — ${scanned} offres actives, lecture seule, sans réseau ===\n`);

  for (const dim of DIMS) {
    const s = stats.get(dim)!;
    console.log(`── ${dim} ──`);
    console.log(`   rempli AVANT      ${String(s.before).padStart(6)}  (${pct(s.before)})`);
    console.log(`   rempli APRÈS      ${String(s.after).padStart(6)}  (${pct(s.after)})`);
    console.log(`   gain              ${String(s.after - s.before).padStart(6)}`);
    console.log(`   null attendu      ${String(scanned - s.after).padStart(6)}  (${pct(scanned - s.after)})`);
    console.log(`   origine :`);
    for (const [o, n] of [...s.byOrigin].sort((a, b) => b[1] - a[1])) {
      console.log(`     ${o.padEnd(14)} ${String(n).padStart(6)}`);
    }
    console.log(`   valeurs :`);
    for (const [v, n] of [...s.byValue].sort((a, b) => b[1] - a[1])) {
      console.log(`     ${v.padEnd(24)} ${String(n).padStart(6)}`);
    }
    console.log(`   conflits entre preuves : ${s.conflicts}`);
    for (const c of s.conflictSamples) console.log(`     · ${c}`);
    console.log();
  }

  console.log('── isSeasonal (caractéristique indépendante) ──');
  console.log(`   isSeasonal = true  ${String(seasonal.total).padStart(6)}  (${pct(seasonal.total)})`);
  console.log(`   null/absent        ${String(scanned - seasonal.total).padStart(6)}  (${pct(scanned - seasonal.total)})`);
  console.log(`   origine :`);
  for (const [o, n] of [...seasonal.byOrigin].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${o.padEnd(14)} ${String(n).padStart(6)}`);
  }
  console.log(`   croisement avec employmentTerm :`);
  console.log(`     + FIXED_TERM     ${String(seasonal.withFixedTerm).padStart(6)}`);
  console.log(`     + TEMPORARY      ${String(seasonal.withTemporary).padStart(6)}`);
  console.log(`     + PERMANENT      ${String(seasonal.withPermanent).padStart(6)}`);
  console.log(`     sans durée       ${String(seasonal.withoutTerm).padStart(6)}`);
  console.log();

  console.log('── conflits workTime par SOURCE (un adaptateur faux se verrait ici) ──');
  for (const [src, n] of [...workTimeConflictBySource].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`   ${src.padEnd(28)} ${String(n).padStart(5)}`);
  }
  console.log();

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

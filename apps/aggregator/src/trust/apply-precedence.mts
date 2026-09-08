/**
 * BACKFILL de la priorité de preuve — combien de Jobs changeraient de valeur si
 * l'on écartait les champs démontrés faux ? LECTURE SEULE, sans réseau.
 *
 * Exigé avant toute modification (Loïc, 2026-09-08) : nombre de Jobs impactés,
 * ventilation par source, et exemples réels avant/après.
 *
 *   DATABASE_URL=<prod> npx tsx src/trust/dryrun-precedence.mts
 */

import { PrismaClient } from '@prisma/client';
import { createObserver, EVALUATOR_VERSION, OBSERVED_DIMENSIONS, type ObservedDimension } from './contradictions.js';
import { evaluate, precedenceFor, type TrustLevel } from './verdict.js';
import { resolveCanonicalDimensions } from './resolve.js';

const prisma = new PrismaClient();
const BATCH = 5000;
const APPLY = process.argv.includes('--apply');

type Row = {
  id: string; title: string; description: string | null; raw: unknown; lastSeenAt: Date | null;
  employmentTerm: string | null; workTime: string | null; programType: string | null; engagementType: string | null;
  sources: { sourceKey: string }[];
};

async function main(): Promise<void> {
  // — Passe 1 : mesurer —
  const observer = createObserver();
  let cursor: string | undefined;
  const all: Row[] = [];
  for (;;) {
    const rows = (await prisma.job.findMany({
      where: { isActive: true },
      select: {
        id: true, title: true, description: true, raw: true, lastSeenAt: true,
        employmentTerm: true, workTime: true, programType: true, engagementType: true,
        sources: { where: { isActive: true }, select: { sourceKey: true }, take: 1 },
      },
      orderBy: { id: 'asc' }, take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })) as Row[];
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    for (const r of rows) {
      all.push(r);
      observer.observe({
        sourceKey: r.sources[0]?.sourceKey ?? '(sans source)',
        title: r.title, description: r.description, raw: r.raw, lastSeenAt: r.lastSeenAt,
      });
    }
    process.stderr.write(`  … mesure ${all.length}\r`);
  }

  const trust = new Map<string, TrustLevel>();
  for (const o of observer.result()) {
    const v = evaluate(o, EVALUATOR_VERSION);
    trust.set(`${o.source} ${o.path} ${o.dimension}`, v.level);
  }

  // — Passe 2 : simuler —
  const changes = new Map<string, number>();
  const byDim = new Map<ObservedDimension, number>();
  const byVerdict = new Map<string, number>();
  const byTitleQuality = new Map<string, number>();
  const samplesByVerdict = new Map<string, string[]>();
  const samples: string[] = [];
  /** Les écritures à appliquer, accumulées pendant la simulation. */
  const pending = new Map<string, Record<string, string>>();
  let jobsChanged = 0;

  for (const row of all) {
    const sourceKey = row.sources[0]?.sourceKey ?? '(sans source)';
    const resolved = resolveCanonicalDimensions(
      { sourceKey, title: row.title, description: row.description, raw: row.raw },
      trust,
    );
    let touched = false;
    for (const dim of OBSERVED_DIMENSIONS) {
      const decision = resolved.decisions[dim];
      const next = decision?.value;
      /**
       * La provenance vient de la chaîne COMMUNE : le replay et l'ingest lisent
       * la même décision, donc ne peuvent pas diverger.
       */
      const decidedBy =
        decision?.origin === 'NO_STRUCTURED_EVIDENCE' || decision?.origin === 'AMBIGUOUS_STRUCTURED'
          ? decision.origin
          : (decision?.trustLevel ?? 'INSUFFICIENT_EVIDENCE');
      const titleQuality = decision?.origin === 'TITLE_INFERRED' ? 'TITLE_INFERRED' : 'TITLE_EXPLICIT';
      const current = row[dim];
      if (next && current && next !== current) {
        touched = true;
        byDim.set(dim, (byDim.get(dim) ?? 0) + 1);
        byVerdict.set(decidedBy, (byVerdict.get(decidedBy) ?? 0) + 1);
        // La nature de la preuve n'est comptée que quand le TITRE a décidé.
        if (decision?.origin === 'TITLE_EXPLICIT' || decision?.origin === 'TITLE_INFERRED') {
          byTitleQuality.set(decision.origin, (byTitleQuality.get(decision.origin) ?? 0) + 1);
        }
        const bucket = samplesByVerdict.get(decidedBy) ?? [];
        if (bucket.length < 4) {
          bucket.push(`[${sourceKey}] ${dim} : ${current} → ${next}  « ${row.title.slice(0, 46)} »`);
          samplesByVerdict.set(decidedBy, bucket);
        }
        pending.set(row.id, { ...(pending.get(row.id) ?? {}), [dim]: next });
        if (samples.length < 12) {
          samples.push(`[${sourceKey}] ${dim} : ${current} → ${next}  « ${row.title.slice(0, 52)} »`);
        }
      }
    }
    if (touched) {
      jobsChanged++;
      changes.set(sourceKey, (changes.get(sourceKey) ?? 0) + 1);
    }
  }

  console.log(`\n\n=== DRY-RUN PRIORITÉ DE PREUVE — ${all.length} offres, ${EVALUATOR_VERSION} ===\n`);
  console.log(`Jobs dont une valeur canonique CHANGERAIT : ${jobsChanged}`);
  console.log(`\nPar dimension :`);
  for (const [d, n] of [...byDim].sort((a, b) => b[1] - a[1])) console.log(`  ${d.padEnd(18)} ${n}`);
  console.log(`\n=== CONTRÔLE : à quel VERDICT chaque changement est-il imputable ? ===`);
  for (const level of ['UNTRUSTED', 'DEGRADED', 'TRUSTED', 'INSUFFICIENT_EVIDENCE', 'NO_STRUCTURED_EVIDENCE', 'AMBIGUOUS_STRUCTURED']) {
    const n = byVerdict.get(level) ?? 0;
    const verdict = level === 'INSUFFICIENT_EVIDENCE' && n > 0 ? '  ← ANOMALIE : doit être 0' : '';
    console.log(`  ${level.padEnd(26)} ${String(n).padStart(6)}${verdict}`);
    for (const s of samplesByVerdict.get(level) ?? []) console.log(`      ${s}`);
  }

  console.log(`\n--- Quand le TITRE décide, quelle est la qualité de la preuve ? ---`);
  for (const q of ['TITLE_EXPLICIT', 'TITLE_INFERRED']) {
    console.log(`  ${q.padEnd(26)} ${String(byTitleQuality.get(q) ?? 0).padStart(6)}`);
  }

  /**
   * LES INVARIANTS, vérifiés automatiquement. Si l'un tombe, l'écriture ne doit
   * pas avoir lieu — c'est le contrat passé avant d'autoriser l'application.
   */
  const insufficient = byVerdict.get('INSUFFICIENT_EVIDENCE') ?? 0;
  const ambiguous = byVerdict.get('AMBIGUOUS_STRUCTURED') ?? 0;
  const invariants: [string, boolean][] = [
    ['INSUFFICIENT_EVIDENCE ne change rien', insufficient === 0],
    ['AMBIGUOUS_STRUCTURED ne tranche jamais', ambiguous === 0],
    ['TRUSTED garde la priorité au champ structuré', precedenceFor('TRUSTED')[0] === 'STRUCTURED'],
    ['DEGRADED : une INFÉRENCE ne bat pas le champ',
      precedenceFor('DEGRADED').indexOf('TITLE_INFERRED') > precedenceFor('DEGRADED').indexOf('STRUCTURED')],
    ['UNTRUSTED : le champ n’est jamais consulté', !precedenceFor('UNTRUSTED').includes('STRUCTURED')],
  ];
  console.log(`\n=== INVARIANTS ===`);
  let allGreen = true;
  for (const [label, ok] of invariants) {
    if (!ok) allGreen = false;
    console.log(`  ${ok ? 'OK  ' : 'ÉCHEC'} ${label}`);
  }
  console.log(allGreen ? '\n  → tous verts : application autorisée' : '\n  → UN INVARIANT EST TOMBÉ : ne pas appliquer');

  if (APPLY && allGreen) {
    console.log(`\n=== ÉCRITURE ===`);
    let written = 0;
    for (const [id, data] of pending) {
      await prisma.job.update({ where: { id }, data });
      written++;
      if (written % 200 === 0) process.stderr.write(`  … ${written} écrites\r`);
    }
    console.log(`  ${written} Jobs mis à jour`);
  } else if (APPLY) {
    console.log(`\n  ÉCRITURE REFUSÉE : un invariant est tombé.`);
  }

  console.log(`\nPar source :`);
  for (const [s, n] of [...changes].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${s.padEnd(28)} ${n}`);
  console.log(`\nExemples réels (avant → après) :`);
  for (const s of samples) console.log(`  ${s}`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

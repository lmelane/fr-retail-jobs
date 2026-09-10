/**
 * L'OBSERVATOIRE DES CONTRADICTIONS, sur toute la base — LECTURE SEULE.
 *
 * Aucun réseau, aucune écriture. Produit le classement exigé avant toute
 * modification de priorité : combien de triplets ont assez de données, leur
 * répartition par niveau, les pires par VOLUME et par TAUX, avec des exemples.
 *
 * Test de validité du modèle (Loïc) : PVH doit ressortir NATURELLEMENT, sans
 * qu'aucune règle ne porte son nom. S'il ne ressort pas alors qu'on connaît
 * déjà ses 485 incohérences, c'est la mesure qui est mauvaise.
 *
 *   DATABASE_URL=<prod> npx tsx scripts/trust/measure.mts
 */

import { PrismaClient } from '@prisma/client';
import { createObserver, EVALUATOR_VERSION } from '../../src/trust/contradictions.js';
import { evaluate, MIN_EVIDENCE, type TrustLevel } from '../../src/trust/verdict.js';
import { persistTrust } from '../../src/trust/persist.js';

const prisma = new PrismaClient();
const BATCH = 5000;
const PERSIST = process.argv.includes('--persist');

async function main(): Promise<void> {
  const observer = createObserver();
  let scanned = 0;
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.job.findMany({
      where: { isActive: true },
      select: {
        id: true, title: true, description: true, raw: true, lastSeenAt: true,
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
      observer.observe({
        sourceKey: row.sources[0]?.sourceKey ?? '(sans source)',
        title: row.title,
        description: row.description,
        raw: row.raw,
        lastSeenAt: row.lastSeenAt,
      });
    }
    process.stderr.write(`  … ${scanned} offres\r`);
  }

  const observations = observer.result();
  const verdicts = observations.map((o) => ({ o, v: evaluate(o, EVALUATOR_VERSION) }));

  const byLevel = new Map<TrustLevel, number>();
  for (const { v } of verdicts) byLevel.set(v.level, (byLevel.get(v.level) ?? 0) + 1);

  console.log(`\n=== OBSERVATOIRE DES CONTRADICTIONS — ${scanned} offres, ${EVALUATOR_VERSION} ===\n`);
  console.log(`Triplets source × chemin × dimension observés : ${observations.length}`);
  console.log(`  dont assez de données (≥ ${MIN_EVIDENCE} comparables) : ${verdicts.filter((x) => x.o.comparable >= MIN_EVIDENCE).length}`);
  console.log(`\nRépartition par niveau :`);
  for (const level of ['TRUSTED', 'DEGRADED', 'UNTRUSTED', 'INSUFFICIENT_EVIDENCE'] as const) {
    console.log(`  ${level.padEnd(24)} ${byLevel.get(level) ?? 0}`);
  }

  const judged = verdicts.filter((x) => x.v.level !== 'INSUFFICIENT_EVIDENCE');

  console.log(`\n--- TOP 20 par VOLUME de contradictions (offres impactées) ---`);
  console.log(`${'source'.padEnd(24)} ${'chemin'.padEnd(22)} ${'dimension'.padEnd(15)} ${'contra'.padStart(6)} ${'/compar'.padStart(8)} ${'taux'.padStart(7)}  niveau`);
  for (const { o, v } of [...judged].sort((a, b) => b.o.contradictions - a.o.contradictions).slice(0, 20)) {
    console.log(
      `${o.source.slice(0, 23).padEnd(24)} ${o.path.slice(0, 21).padEnd(22)} ${o.dimension.padEnd(15)} ` +
      `${String(o.contradictions).padStart(6)} ${String(o.comparable).padStart(8)} ${(o.contradictionRate * 100).toFixed(1).padStart(6)}%  ${v.level}`,
    );
  }

  console.log(`\n--- TOP 20 par TAUX de contradiction ---`);
  for (const { o, v } of [...judged].sort((a, b) => b.o.contradictionRate - a.o.contradictionRate).slice(0, 20)) {
    console.log(
      `${o.source.slice(0, 23).padEnd(24)} ${o.path.slice(0, 21).padEnd(22)} ${o.dimension.padEnd(15)} ` +
      `${String(o.contradictions).padStart(6)} ${String(o.comparable).padStart(8)} ${(o.contradictionRate * 100).toFixed(1).padStart(6)}%  ${v.level}`,
    );
  }

  console.log(`\n--- EXEMPLES RÉELS sur les triplets UNTRUSTED ---`);
  for (const { o, v } of judged.filter((x) => x.v.level === 'UNTRUSTED').slice(0, 6)) {
    console.log(`\n  ${o.source} · ${o.path} · ${o.dimension} — ${v.reason}`);
    for (const s of o.samples.slice(0, 3)) {
      console.log(`    champ dit « ${s.structured} », titre dit « ${s.fromTitle} » — ${s.title}`);
    }
  }

  if (PERSIST) {
    const stats = await persistTrust(prisma, observations, EVALUATOR_VERSION);
    console.log(`\n=== PERSISTANCE ===`);
    console.log(`  verdicts créés   ${stats.created}`);
    console.log(`  verdicts mis à jour ${stats.updated}`);
    console.log(`  observations empilées (historique permanent) ${stats.observations}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

/**
 * Aperçu du registre explicite en LECTURE SEULE, sans passer par `cli.ts` (qui ouvre un PipelineRun) :
 * `previewRegistryReview` lit dans une transaction READ ONLY. Rejeu :
 *   db.py readonly npx tsx audits/2026-10-03/stock-exceptions/apercu-registre.mts <decisions.json> <sortie.json>
 * L'aperçu à APPLIQUER se régénère par `registry-review --decisions=… --output=…` le jour de l'application
 * (le hachage inclut les publications actives, qui bougent à chaque RUN).
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { previewRegistryReview } from '../../../apps/aggregator/src/registry/explicitRegistry.js';
const [decisions, output] = process.argv.slice(2);
const prisma = new PrismaClient();
try {
  const preview = await previewRegistryReview(prisma, JSON.parse(readFileSync(decisions, 'utf8')));
  writeFileSync(output, JSON.stringify({ entries: preview.plan.entries.length, refused: preview.refused, retirements: preview.retirements, hash: preview.hash }, null, 1) + '\n');
  console.log(JSON.stringify({ entries: preview.plan.entries.length, refused: preview.refused.length, retirements: preview.retirements.length }));
} finally { await prisma.$disconnect(); }

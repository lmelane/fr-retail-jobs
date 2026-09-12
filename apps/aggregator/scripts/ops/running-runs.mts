/**
 * LES RUNS NON TERMINÉS — la question à poser AVANT tout déploiement.
 *
 * Un déploiement pendant un run borné TUE le run : c'est arrivé le 2026-09-09, le deploy de la PR 60 a
 * interrompu la validation en cours. La garde ne peut donc pas se contenter du dernier run d'UNE commande :
 * elle demande s'il existe, quelle que soit la commande, un run que rien n'a encore terminé.
 *
 * `finishedAt IS NULL` est le critère, jamais le statut : un run tué net garde un statut d'exécution et
 * n'écrit jamais sa fin — le lire par le statut laisserait passer exactement le cas dangereux.
 *
 * usage: db.py readonly npx tsx scripts/ops/running-runs.mts
 * sortie: { running: [...], recent: [...] } — `running` vide = aucun run en vol.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const running = await prisma.pipelineRun.findMany({
  where: { finishedAt: null },
  select: { id: true, command: true, status: true, startedAt: true, revision: true },
  orderBy: { startedAt: 'desc' },
});

const recent = await prisma.pipelineRun.findMany({
  select: { command: true, status: true, startedAt: true, finishedAt: true, revision: true },
  orderBy: { startedAt: 'desc' },
  take: 5,
});

console.log(JSON.stringify({ running, recent }, null, 1));
await prisma.$disconnect();

import { PrismaClient } from '@prisma/client';
/**
 * READ-ONLY: the production pipeline runs currently in flight, one per line, for the deploy guard.
 * Prints `RUNNING <command> <id> <startedAt>` per row, or `NONE`. Deploying over a RUNNING row kills it mid-write
 * (incident 2026-09-09 18:35 UTC), so this is the second, independent witness next to the service startCommand.
 */
const p = new PrismaClient();
try {
  const rows = await p.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return tx.pipelineRun.findMany({ where: { status: 'RUNNING' }, select: { id: true, command: true, startedAt: true } });
  });
  for (const r of rows) console.log(`RUNNING ${r.command} ${r.id} ${r.startedAt.toISOString()}`);
  if (!rows.length) console.log('NONE');
} finally { await p.$disconnect(); }
